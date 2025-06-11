const fs = require('fs');
const http = require('http');
const https = require('https');
const WebSocket = require("express-ws");
const express = require('express');
const compression = require("compression");
const cors = require("cors");
const app = express();
const protocol = require("./public/json/protocol.json");
const p = require("./serverProtocol");
const cardSetup = require("./public/json/cardData.json");

// the players are contained in lobbies, and hold their socket and data
class Player {
    constructor(socketClass, number, playerData) {
        this.socket = socketClass;
        this.number = number;
        this.name = playerData[2];
    }

    talk(data) {
        this.socket.talk(data);
    }
}

// a basic id stored, plus some metadata like who can see the card
let identityCount = 0;
class Card {
    constructor(visual) {
        this.id = identityCount;
        identityCount++;
        this.visual = visual;
        this.flipped = [true, true, true, true];
        this.inverted = false;
        this.draggingPlayer = null;
        this.position = {x: 0, y: 0};
        this.cardArea = null;
    }
}

// a class for card areas, which stores card elements in its list
class CardArea {
    constructor(id) {
        this.id = id;
        this.cards = [];
    }

    addCard(card, position) {
        this.cards.splice(position, 0, card);
        card.cardArea = this;
    }

    shuffle() {
        let placeholder = [];
        while (this.cards.length > 0) placeholder.push(this.cards.splice(Math.floor(Math.random() * this.cards.length), 1)[0]);
        this.cards = placeholder;
    }
}

// lobbies hold all players and states of a given game
const lobbies = [];
class Lobby {
    constructor(socketClass, playerData) {
        this.code = playerData[1];
        this.players = [null, null, null, null];
        this.playerMousePositions = [-1, -1, -1, -1, -1, -1, -1, -1];
        this.cardAreas = [
            // player 1: hand, fate, mod 1 and 2 [0-3]
            new CardArea(1000), new CardArea(1001), new CardArea(1002), new CardArea(1003),
            // player 2: hand, fate, mod 1 and 2 [4-7]
            new CardArea(1000), new CardArea(1001), new CardArea(1002), new CardArea(1003),
            // player 3: hand, fate, mod 1 and 2 [8-11]
            new CardArea(1000), new CardArea(1001), new CardArea(1002), new CardArea(1003),
            // player 4: hand, fate, mod 1 and 2 [12-15]
            new CardArea(1000), new CardArea(1001), new CardArea(1002), new CardArea(1003),
            // tarot discard, tarot draw, fate draw, fate discard [16-19]
            new CardArea(0), new CardArea(1), new CardArea(2), new CardArea(3), new CardArea(4), new CardArea(5)
        ];

        for (let i = 0; i < cardSetup.length; i++) {
            let card = cardSetup[i];
            if (card.color === "var(--black)") for (let j = 0; j < card.copies; j++) {
              if (!card.alwaysAdd) this.cardAreas[17].addCard(new Card(i), 0);
            }
            else for (let j = 0; j < card.copies; j++) {
              if (!card.alwaysAdd) this.cardAreas[18].addCard(new Card(i), 0);
            }
        }
      
        // cut the decks in half randomly
        this.cardAreas[17].shuffle();
        this.cardAreas[18].shuffle();
        this.cardAreas[17].cards = this.cardAreas[17].cards.splice(0, Math.floor(this.cardAreas[17].cards.length/2) - 5 + Math.floor(Math.random() * 10));
        this.cardAreas[18].cards = this.cardAreas[18].cards.splice(0, Math.floor(this.cardAreas[18].cards.length/2) - 5 + Math.floor(Math.random() * 10));
      
        for (let i = 0; i < cardSetup.length; i++) {
            let card = cardSetup[i];
            if (card.color === "var(--black)") for (let j = 0; j < card.copies; j++) {
              if (card.alwaysAdd) this.cardAreas[17].addCard(new Card(i), 0);
            }
            else for (let j = 0; j < card.copies; j++) {
              if (card.alwaysAdd) this.cardAreas[18].addCard(new Card(i), 0);
            }
        }
      
        this.cardAreas[17].shuffle();
        this.cardAreas[18].shuffle();
      
        console.log(`New lobby created with code ${this.code}`);
        this.addPlayer(socketClass, playerData);
    }

    addPlayer(socketClass, playerData) {
        let playerslot = 0;
        for (let i = 0; i < 4; i++) {
            if (this.players[playerslot] === null) break;
            playerslot++;
        }
        if (playerslot === 4) return;
        const player = new Player(socketClass, playerslot, playerData);
        this.players[playerslot] = player;
        this.sendFullUpdate();
        console.log(`A player has joined a lobby with code ${this.code}`);
    }

    findCardById(id) {
        for (let i of this.cardAreas) {
            for (let j of i.cards) {
                if (j.id === id) return j;
            }
        }
    }

    // searches every lobby to test if a code exists
    static findCode(code) {
        for (let i = 0; i < lobbies.length; i++) if (lobbies[i].code === code) return i;
        return null;
    }

    static fromPlayer(socketClass) {
        for (let l = 0; l < lobbies.length; l++) {
            for (let i = 0; i < lobbies[l].players.length; i++) {
                if (lobbies[l].players[i] === null) continue;
                if (lobbies[l].players[i].socket === socketClass) return [lobbies[l], lobbies[l].players[i]];
            }
        }
    }

    // sends what this server thinks the client should be seeing, run every second
    sendFullUpdate() {
        let playerNames = ["", "", "", ""];
        for (let o = 0; o < this.players.length; o++) if (this.players[o] !== null) playerNames[o] = this.players[o].name;
        for (let o = 0; o < this.players.length; o++) {
            let player = this.players[o];
            if (player === null) {
                this.playerMousePositions[o * 2 + 0] = -1;
                this.playerMousePositions[o * 2 + 1] = -1;
                continue;
            }
            let data = [protocol.client.fullLobbyUpdate, this.code, player.number];
            data.push(this.cardAreas.length);
            for (let area of this.cardAreas) {
                data.push(area.cards.length);
                for (let card of area.cards) {
                    data.push(
                        card.id,
                        card.visual,
                        (card.draggingPlayer !== null && card.draggingPlayer !== player) ? card.position.x : -1,
                        (card.draggingPlayer !== null && card.draggingPlayer !== player) ? card.position.y : -1,
                        card.flipped[o],
                        card.flipped,
                        card.inverted ? 1 : 0,
                        (card.draggingPlayer !== null && card.draggingPlayer !== player) ? 1 : 0,
                        area.cards.indexOf(card)
                    );
                }
                data.push(0);
            }
            data.push(0);
            data.push(this.playerMousePositions);
            data.push(4, playerNames[0], playerNames[1], playerNames[2], playerNames[3], 0);
            player.talk(p.encodePacket(data, ["int8", "string", "int8", "repeat", "repeat", "int32", "int8", "float32", "float32", "int8", "float32array", "int8", "int8", "int8", "end", "end", "float32array", "repeat", "string", "end"]))
        }
    }
}


// the websocket class
const sockets = {
    tally: 1,
    clients: [],
    class: class {
        constructor(socket, request) {
            this.id = sockets.tally++;

            this.socket = socket;
            this.request = request;
            this.socket.binaryType = "arraybuffer";

            socket.onerror = error => this.error(error);
            socket.onclose = reason => this.close(reason);
            socket.onmessage = data => this.message(data);
        }

        message(packet) {
            let reader = new DataView(packet.data);

            switch (reader.getInt8(0)) {
                case protocol.server.checkIfCodeExists: {
                    // checks and informs a client if a lobby code can be attributed to an existing lobby
                    const d = p.decodePacket(reader, ["int8", "string"]);
                    this.talk(p.encodePacket([protocol.client.doesCodeExist, Lobby.findCode(d[1]) === null ? 0 : 1], ["int8", "int8"]));
                    break;
                }
                case protocol.server.joinLobbyWithCode: {
                    // checks if a lobby with the given code exists, and either creates a lobby or joins an existing one
                    const d = p.decodePacket(reader, ["int8", "string", "string"]);
                    const foundLobby = Lobby.findCode(d[1]);

                    if (foundLobby === null) lobbies.push(new Lobby(this, d));
                    else lobbies[foundLobby].addPlayer(this, d);

                    break;
                }
                case protocol.server.mouseMoved: {
                    // updates a player's mouse position
                    const d = p.decodePacket(reader, ["int8", "float32", "float32"]);
                    const l = Lobby.fromPlayer(this);
                    if (l === undefined) break;
                    const player = l[0].players.indexOf(l[1]);
                    l[0].playerMousePositions[player * 2 + 0] = d[1];
                    l[0].playerMousePositions[player * 2 + 1] = d[2];
                    break;
                }
                case protocol.server.flipCardForAll: {
                    // flips a card for all players
                    const d = p.decodePacket(reader, ["int8", "int32", "int8"]);
                    const l = Lobby.fromPlayer(this);
                    const card = l[0].findCardById(d[1]);
                    if (card === undefined) break;
                    if (d[2]) card.flipped = [true, true, true, true];
                    else card.flipped = [false, false, false, false];
                    break;
                }
                case protocol.server.shuffleArea: {
                    const d = p.decodePacket(reader, ["int8", "int8"]);
                    const l = Lobby.fromPlayer(this);
                    l[0].cardAreas[d[1]].shuffle();
                    break;
                }
                case protocol.server.removePlayer: {
                    const d = p.decodePacket(reader, ["int8", "int8"]);
                    const l = Lobby.fromPlayer(this);
                    if (!l) return;
                    l[0].players[d[1]].socket.close();
                    console.log("done with player " + d[1]);
                    break;
                }
                case protocol.server.updateCard: {
                    // recieves a card id, and applies whatever effects a client asks
                    // 1: cardid, 2: card posx, 3: card posy, 4: card area parent, 5: flipped, 6: inverted, 7: dragging, 8: order
                    const d = p.decodePacket(reader, ["int8", "int32", "float32", "float32", "int8", "int8", "int8", "int8", "int32"]);
                    const l = Lobby.fromPlayer(this);
                    const player = l[0].players.indexOf(l[1]);
                    const card = l[0].findCardById(d[1]);
                    if (card === undefined) break;

                    // interpret based on what player is telling us this
                    switch (player) {
                        case 0: case 1: {
                            if (d[7]) card.position = {x: l[0].playerMousePositions[player * 2], y: l[0].playerMousePositions[player * 2 + 1]};
                            else card.position = {x: d[2], y: d[3]};
                            break;
                        }
                        case 2: case 3: {
                            if (d[7]) card.position = {x: 1 - l[0].playerMousePositions[player * 2], y: 1 - l[0].playerMousePositions[player * 2 + 1]};
                            else card.position = {x: 1 - d[2], y: 1 - d[3]};
                            break;
                        }
                    }
                    l[0].cardAreas[d[4]].addCard(card.cardArea.cards.splice(card.cardArea.cards.indexOf(card), 1)[0], d[8]);
                    card.flipped[player] = !!d[5];
                    card.inverted = !!d[6];
                    
                    if (d[7]) {
                      for (let area of l[0].cardAreas) for (let card of area.cards) if (card.draggingPlayer === l[1]) card.draggingPlayer = null;
                      card.draggingPlayer = l[1];
                    }
                    else if (card.draggingPlayer === l[1]) card.draggingPlayer = null;
                    break;
                }
                default: {
                    console.log(`An unknown code has been recieved: ${reader.getInt8(0)}`);
                    break;
                }
            }
        }

        close() {
            const l = Lobby.fromPlayer(this);
            if (!l) return;
            l[0].players[l[0].players.indexOf(l[1])] = null;
            let myIndex = sockets.clients.indexOf(this);
            if (myIndex >= 0) sockets.clients.splice(myIndex, 1);
        }

        talk(data) {
            if (this.socket.readyState === 1) this.socket.send(data, { binary: true });
        }

        error(error) {
            throw error;
        }

        kick(reason) {

        }
    },

    connect(socket, request) {
        // logs the connection attempt, then sends a connection confirmation to a client
        console.log(`Socket ${sockets.tally} has connected. Active sockets: ${sockets.clients.length + 1}`);
        let connectingSocket = new sockets.class(socket, request);
        sockets.clients.push(connectingSocket);
        connectingSocket.talk(p.encodePacket([protocol.client.connected], ["int8"]));
    }
}

/*// websocket server stuff, creates a locally hosted server for us
const credentials = { key: privateKey, cert: certificate };

app.use(express.static("public"));
app.get("/", (req, res) => {
    res.sendFile(__dirname + "public/index.html");
});

const httpServer = http.createServer(app);
const httpsServer = https.createServer(credentials, app);
WebSocket(app, httpsServer);

app.ws("/wss", sockets.connect);

httpServer.listen(8080);
httpsServer.listen(8443, () => {
    console.log("Server running on port 8443")
});*/
const site = ((port, connect) => {
  WebSocket(app);
  
  app.ws("/ws", connect);
  
  app.use(compression());
  //app.use(minify());
  app.use(cors());
  app.use(express.static("public"));
  app.use(express.json());
  
  app.listen(port, () => console.log("Express is now active on port %s", port));
  return (directory, callback) => app.get(directory, callback);
})(3000, sockets.connect);

app.use(express.static("public"));
app.get("/", (req, res) => {
	res.sendFile(__dirname + "/public/index.html");
});


function update() {
    for (let lobby of lobbies) {
        lobby.sendFullUpdate();
    }
}
setInterval(update, 1000/60);