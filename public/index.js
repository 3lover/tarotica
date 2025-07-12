import {decodePacket, encodePacket} from "./clientProtocol.js";

const doc = {
    frontPageSubmitButton: document.getElementById("frontPageSubmitButton"),
    frontMenuCodeInput: document.getElementById("frontMenuCodeInput"),
    frontMenuNameInput: document.getElementById("frontMenuNameInput"),
    tableViewContainer: document.getElementById("tableViewContainer"),
    frontMenuContainer: document.getElementById("frontMenuContainer"),
}

let socket = null;
let W = window.innerWidth;
let H = window.innerHeight;
let R = W/H;
window.addEventListener("resize", function(e) {
    W = window.innerWidth;
    H = window.innerHeight;
    R = W/H;
});

if (localStorage.getItem("frontMenuCodeInput")) doc.frontMenuCodeInput.value = localStorage.getItem("frontMenuCodeInput");
if (localStorage.getItem("frontMenuNameInput")) doc.frontMenuNameInput.value = localStorage.getItem("frontMenuNameInput");
doc.frontMenuCodeInput.addEventListener("input", function(e) {
  localStorage.setItem("frontMenuCodeInput", doc.frontMenuCodeInput.value);
});
doc.frontMenuNameInput.addEventListener("input", function(e) {
  localStorage.setItem("frontMenuNameInput", doc.frontMenuNameInput.value);
});

// player numbers and their cooresponding fields
let playerId = 0;
const cardConversions = [
    [1000, 3000, 4000, 5000,  1001, 3001, 4001, 5001,  1002, 3002, 4002, 5002,  1003, 3003, 4003, 5003,  2000, 2001, 2002, 2003, 6000, 6001],
    [1000, 3000, 4000, 5000,  1001, 3001, 4001, 5001,  1002, 3002, 4002, 5002,  1003, 3003, 4003, 5003,  2000, 2001, 2002, 2003, 6000, 6001],
    [1003, 3003, 4003, 5003,  1002, 3002, 4002, 5002,  1001, 3001, 4001, 5001,  1000, 3000, 4000, 5000,  2003, 2002, 2001, 2000, 6001, 6000],
    [1003, 3003, 4003, 5003,  1002, 3002, 4002, 5002,  1001, 3001, 4001, 5001,  1000, 3000, 4000, 5000,  2003, 2002, 2001, 2000, 6001, 6000],
];

const mouseFollowers = [];
for (let i = 0; i < 4; i++) {
    let follower = document.createElement("div");
    follower.classList.add("mouseFollower");
    switch (i) {
        case 0: follower.style.backgroundColor = "var(--red)"; break;
        case 1: follower.style.backgroundColor = "var(--lightBlue)"; break;
        case 2: follower.style.backgroundColor = "var(--yellow)"; break;
        case 3: follower.style.backgroundColor = "var(--green)"; break;
    }
    mouseFollowers.push(follower);
    doc.tableViewContainer.appendChild(follower);
}

let protocol = null;
async function fetchProtocol() {
    protocol = await (await fetch("./json/protocol.json")).json();
}
await fetchProtocol();

let cardData = null;
async function fetchCardData() {
    cardData = await (await fetch("./json/cardData.json")).json();
    for (let c = 0; c < cardData.length; c++) {
        cardData[c] = Object.assign({}, cardData[c], {
            "id": c,
            "position": {"x": 0, "y": 0},
            "dimensions": {"x": 0.15, "y": 0.18},
        });
        cardData[c].fullDescription = cardData[c].fullDescription.replaceAll("$", "<span class='keyword'>").replaceAll("%", "</span>").replaceAll("^", "<br><br>OR<br><br>");
        cardData[c].shortDescription = cardData[c].shortDescription.replaceAll("$", "<span class='keyword'>").replaceAll("%", "</span>");
    }
}
await fetchCardData();

function findCard(visual) {
    for (let c  of cardData) {
        if (c.id === visual) return c;
    }
}

// keeps constant track of mouse position
let mousePos = {x: 0, y: 0};
document.addEventListener("mousemove", function(e) {
    mousePos = {x: e.clientX, y: e.clientY};
    if (socket !== null) socket.talk(encodePacket([protocol.server.mouseMoved, mousePos.x/W, mousePos.y/H], ["int8", "float32", "float32"]));
});
let heldCommands = {shift: false};
document.addEventListener("keydown", function(e) {
    if (e.shiftKey) heldCommands.shift = true;
});
document.addEventListener("keyup", function(e) {
    if (!e.shiftKey) heldCommands.shift = false;
});

// the class for individual cards that can be dragged around
class Card {
    constructor(id, p) {
        this.id = id;
        this.visual = p.id;
        this.dimensions = p.dimensions;
        this.position = p.position;
        this.oldPosition = {x: 0, y: 0};
        this.rememberedMousePos = {x: 0, y: 0};
        this.visibility = [0, 0, 0, 0];
        this.dragging = false;
        this.otherDragging = true;
        this.refractory = 0;
        this.mouseOver = false;
        this.focused = false;
        this.cardArea = null;
        this.marked = true;
        this.ticks = 5;

        this.color = p.color ?? "var(--black)";
        this.title = p.title ?? "Unnamed Card";
        this.shortDescription = p.shortDescription ?? "No Description";
        this.fullDescription = p.fullDescription ?? this.shortDescription;
        this.keywords = p.keywords ?? "";
        this.flipped = true;
        this.inverted = false;
        this.createHtmlElement();
        
        this.pixelDimensions = this.element.getBoundingClientRect();

        const card = this;
        this.element.addEventListener("mousedown", function(e) {
            let usedCard;
            if (spaceHeld && card.cardArea.type === 1) {
                usedCard = card.cardArea.cards[card.cardArea.cards.length - 1];
            } else usedCard = card;
            if (usedCard.dragging && usedCard.otherDragging) return;
            usedCard.dragging = true;
            usedCard.otherDragging = false;
            usedCard.oldPosition = {x: usedCard.position.x, y: usedCard.position.y};
            usedCard.rememberedMousePos = {x: mousePos.x, y: mousePos.y};
            usedCard.sendUpdateRequest();
        });
    }

    // creates an html element to represent the card
    createHtmlElement() {
        this.element = document.createElement("div");
        this.element.style.display = "none";
        this.element.classList.add("singleCardContainer");
        this.element.style.left = `${this.position.x * W}px`;
        this.element.style.top = `${this.position.y * H}px`;
        this.element.style.width = `${this.dimensions.x * H}px`;
        this.element.style.height = `${this.dimensions.y * H}px`;
        this.element.style.backgroundColor = this.color;

        this.titleElement = document.createElement("div");
        this.titleElement.innerHTML = this.title;
        this.titleElement.classList.add("cardTitle");
        this.element.appendChild(this.titleElement);

        this.descriptionElement = document.createElement("div");
        this.descriptionElement.innerHTML = this.shortDescription;
        this.descriptionElement.classList.add("cardDescription");
        this.element.appendChild(this.descriptionElement);

        doc.tableViewContainer.appendChild(this.element);

        this.focusElement = document.createElement("div");
        this.focusElement.classList.add("singleCardContainer", "focusViewCard");
        this.focusElement.style.display = "none";
        this.focusElement.style.backgroundColor = this.color;

        this.focusTitleElement = document.createElement("div");
        this.focusTitleElement.innerHTML = this.title;
        this.focusTitleElement.classList.add("cardTitle", "focusViewTitle");
        this.focusElement.appendChild(this.focusTitleElement);

        this.focusDescriptionElement = document.createElement("div");
        this.focusDescriptionElement.innerHTML = this.fullDescription + "<br><br><span class='keyword'>" + this.keywords + "</span>";
        this.focusDescriptionElement.classList.add("cardDescription", "focusViewDescription");
        this.focusElement.appendChild(this.focusDescriptionElement);      

        const ref = this;
        this.focusScrollEvent = function(e) {
            if (!ref.focused) return;
            ref.focusDescriptionElement.scroll({
                top: e.deltaY,
                behavior: "smooth",
            });
        }
        document.addEventListener("wheel", this.focusScrollEvent);
      
        doc.tableViewContainer.appendChild(this.focusElement);
    }

    // the function run when dragging a card to snap it to the mouse position
    snapToMouse() {
        this.position = {
            x: this.oldPosition.x + (mousePos.x - this.rememberedMousePos.x)/W,
            y: this.oldPosition.y + (mousePos.y - this.rememberedMousePos.y)/H,
        };
        this.sendUpdateRequest();
    }

    updatePosition() {
        this.element.style.left = `${this.position.x * W}px`;
        this.element.style.top = `${this.position.y * H}px`;
        this.element.style.width = `${this.dimensions.x * H}px`;
        this.element.style.height = `${this.dimensions.y * H}px`;
        this.element.style.backgroundColor = this.color;
        this.pixelDimensions = this.element.getBoundingClientRect();

        if (!this.visibility[0] || (playerId === 0 && !this.flipped)) this.element.style.borderTopColor = "var(--red)";
        else this.element.style.borderTopColor = ""
        if (!this.visibility[1] || (playerId === 1 && !this.flipped)) this.element.style.borderRightColor = "var(--blue)";
        else this.element.style.borderRightColor = "";
        if (!this.visibility[2] || (playerId === 2 && !this.flipped)) this.element.style.borderBottomColor = "var(--yellow)";
        else this.element.style.borderBottomColor = "";
        if (!this.visibility[3] || (playerId === 3 && !this.flipped)) this.element.style.borderLeftColor = "var(--green)";
        else this.element.style.borderLeftColor = "";

        if (this.flipped) {
            this.titleElement.style.display = "none";
            this.descriptionElement.style.display = "none";
            this.focusTitleElement.style.display = "none";
            this.focusDescriptionElement.style.display = "none";
        } else {
            this.titleElement.style.display = "block";
            this.descriptionElement.style.display = "block";
            this.focusTitleElement.style.display = "block";
            this.focusDescriptionElement.style.display = "block";
        }

        if (this.inverted) {
            //this.element.style.transform = "rotate(180deg)";
            if (this.color === "var(--black)") {
              this.element.style.backgroundColor = "var(--veryDarkGrey)";
              this.focusElement.style.backgroundColor = "var(--veryDarkGrey)";
            } else {
              this.element.style.backgroundColor = "var(--veryDarkRed)";
              this.focusElement.style.backgroundColor = "var(--veryDarkRed)";
            }
        } else {
            //this.element.style.transform = "";
            this.element.style.backgroundColor = this.color;
            this.focusElement.style.backgroundColor = this.color;
        }
    }

    // shows the top card, and hides bottom cards in a deck
    show() {
        if (this.element.style.display == "block") return;
        this.ticks--;
        if (this.ticks > 0) return;
        this.ticks = 5;
        this.element.style.display = "block";
    }

    hide() {
        if (this.element.style.display == "none") return;
        this.ticks--;
        if (this.ticks > 0) return;
        this.ticks = 5;
        this.element.style.display = "none";
    }

    // checks if this card is the focus of a click event
    focus(focus) {
        if (focus) {
            if (this.focused) return;
            this.focused = true;
            this.focusElement.style.display = "block";
        }
        else {
            if (!this.focused) return;
            this.focused = false;
            this.focusElement.style.display = "none";
        }
    }

    mouseOnChecks(first) {
        if (first) this.focus(heldCommands.shift);
        else this.focus(false);
    }

    mouseOffEvent() {
        this.focus(false);
    }
 // 1: cardid, 2: card posx, 3: card posy, 4: card area parent, 5: flipped, 6: inverted, 7: dragging, 8: order
    sendUpdateRequest() {
        this.refractory = 10;
        socket.talk(encodePacket(
            [
                protocol.server.updateCard,
                this.id,
                this.position.x,
                this.position.y,
                cardConversions[playerId].indexOf(this.cardArea.id),
                this.flipped ? 1 : 0,
                this.inverted ? 1 : 0,
                (this.dragging && !this.otherDragging) ? 1 : 0,
                this.cardArea.cards.indexOf(this)
            ],
            ["int8", "int32", "float32", "float32", "int8", "int8", "int8", "int8", "int32"]
        ));
    }

    flipForAll(flip) {
        socket.talk(encodePacket(
            [
                protocol.server.flipCardForAll,
                this.id,
                flip ? 1 : 0
            ],
            ["int8", "int32", "int8"]
        ));
    }
}

// an area that cards snap to and are held in
let cardAreas = [];
class CardArea {
    constructor(p) {
        this.cards = [];
        this.id = p.id;
        // 0: hand  1: deck  2: general field
        this.type = p.type;
        this.cssPosition = p.cssPosition;
        this.AABB = null;
        this.reversed = p.reversed;
        this.mouseOver = false;

        this.hoveringCard = null;
        this.cardMenuOpen = false;
        this.refractory = 0;

        this.createHtmlElement();
    }

    updateColors(playernames) {
        for (let i = 0; i < cardConversions[playerId].length; i++) {
            if (this.id === cardConversions[playerId][i]) {
                switch (Math.floor(i/4)) {
                    case 0: {
                      this.element.style.backgroundColor = "var(--veryDarkRed)";
                      this.element.style.borderColor = "var(--red)";
                      break;
                    }
                    case 1: {
                      this.element.style.backgroundColor = "var(--veryDarkBlue)";
                      this.element.style.borderColor = "var(--blue)";
                      break;
                    }
                    case 2: {
                      this.element.style.backgroundColor = "var(--veryDarkYellow)";
                      this.element.style.borderColor = "var(--yellow)";
                      break;
                    }
                    case 3: {
                      this.element.style.backgroundColor = "var(--veryDarkGreen)";
                      this.element.style.borderColor = "var(--green)";
                      break;
                    }
                }
                if (this.id === 6000 || this.id === 6001) {
                    this.element.style.backgroundColor = "var(--veryDarkGrey)";
                    this.element.style.borderColor = "var(--grey)";
                }
            }
        }
        for (let i = 1; i <= 4; i++) {
            document.getElementById(`player${i}name`).innerText = playernames[playerId < 2 ? i - 1 : 4 - i];
        }
    }

    createHtmlElement() {
        this.element = document.createElement("div");
        if (this.type === 1) this.element.style.borderColor = "var(--white)";
        this.element.classList.add("cardArea");
        this.element.style.left = this.cssPosition.left;
        this.element.style.top = this.cssPosition.top;
        this.element.style.width = this.cssPosition.width;
        this.element.style.height = this.cssPosition.height;
        let bound = this.element.getBoundingClientRect();
        this.AABB = {
            "xmin": bound.left/W,
            "xmax": bound.right/W,
            "ymin": bound.top/H,
            "ymax": bound.bottom/H
        };
        doc.tableViewContainer.appendChild(this.element);

        this.fullViewingElement = document.createElement("div");
        this.fullViewingElement.classList.add("cardAreaFullView");
        this.fullViewingElement.classList.add("noScrollBar");
        doc.tableViewContainer.appendChild(this.fullViewingElement);
    }

    addCard(card, loc = 0) {
        card.cardArea = this;
        this.cards.splice(loc, 0, card);
    }

    removeCard(index) {
        document.removeEventListener("wheel", this.focusScrollEvent);
        this.cards[index].element.remove();
        this.cards[index].focusElement.remove();
        this.cards.splice(index, 1);
    }

    // aligns cards within the box when they aren't being dragged or hovered, and resize this box
    alignCards() {
        this.element.style.left = this.cssPosition.left;
        this.element.style.top = this.cssPosition.top;
        this.element.style.width = this.cssPosition.width;
        this.element.style.height = this.cssPosition.height;
        if (this.mouseOver) {
            if (!this.element.classList.contains("cardAreaHighlight")) this.element.classList.add("cardAreaHighlight");
        } else {
            if (this.element.classList.contains("cardAreaHighlight")) this.element.classList.remove("cardAreaHighlight");
        }
        let bound = this.element.getBoundingClientRect();
        this.AABB = {
            "xmin": bound.left/W,
            "xmax": bound.right/W,
            "ymin": bound.top/H,
            "ymax": bound.bottom/H
        };

        let totalCards = 0;
        let unslotted = false;
        if (this.hoveringCard !== null && this.mouseOver) {
            totalCards = 1;
            unslotted = true;
        }
        if (this.type === 1) {
            let topCard = 2;
            for (let i = 0; i < this.cards.length; i++) {
                this.cards[i].updatePosition();
                if (topCard < 0 && !this.cards[i].dragging) this.cards[i].hide();
                else this.cards[i].show();
                if (this.cards[i].dragging) continue;
                this.cards[i].position = {
                    x: (this.AABB.xmax + this.AABB.xmin - this.cards[i].dimensions.x/R)/2,
                    y: (this.AABB.ymax + this.AABB.ymin - this.cards[i].dimensions.y)/2,
                };
                topCard--;
            }
            return;
        }

        for (let i = 0; i < this.cards.length; i++) {
            this.cards[i].show();
            if (!this.cards[i].dragging) totalCards++;
        }
        let current = 0;
        for (let i = 0; i < this.cards.length; i++) {
            this.cards[i].updatePosition();
            if (this.cards[i].dragging) continue;
            current++;
            let interval = this.reversed
            ? (this.AABB.ymax - this.AABB.ymin - this.cards[i].dimensions.y) / (totalCards + 1)
            : (this.AABB.xmax - this.AABB.xmin - this.cards[i].dimensions.x/R) / (totalCards + 1);
            let pos = this.reversed
            ? this.AABB.ymin + current * interval
            : this.AABB.xmin + current * interval;
            if (unslotted && (
                (this.reversed && (this.hoveringCard.position.y < this.cards[i].position.y)) ||
                (!this.reversed && (this.hoveringCard.position.x < this.cards[i].position.x))
            )) {
                unslotted = false;
                current++;
                pos = this.reversed
                ? this.AABB.ymin + current * interval
                : this.AABB.xmin + current * interval;
            }

            this.cards[i].position = {
                x: !this.reversed ? pos : (this.AABB.xmax + this.AABB.xmin - this.cards[i].dimensions.x/R)/2,
                y: this.reversed ? pos : (this.AABB.ymax + this.AABB.ymin - this.cards[i].dimensions.y)/2,
            }
        }
    }
    
    // if a card is over this card area such that dropping it would insert it, show what would happen were it dropped
    checkSlotIn(card) {
        if (card.position.x > this.AABB.xmax || card.position.x + card.dimensions.x / R < this.AABB.xmin) return false;
        if (card.position.y > this.AABB.ymax || card.position.y + card.dimensions.y < this.AABB.ymin) return false;
        this.hoveringCard = card;
        return true;
    }

    // creates a menu showcasing every card currently identified with the card area (excluding dragged cards)
    showFullView() {
        this.cardMenuOpen = true;
        this.fullViewingElement.style.display = "block";
        if (this.cards.length <= 0) return;
        let maxCols = Math.floor(this.fullViewingElement.getBoundingClientRect().width / (this.cards[0].dimensions.x * 2 * H));
        let xbuffer = (this.fullViewingElement.getBoundingClientRect().width % (this.cards[0].dimensions.x * 2 * H))/2;
        for (let i = 0; i < this.cards.length; i++) {
            let cardCopy = this.cards[i].element.cloneNode(true);
            const usedCardArea = this;
            cardCopy.style.left = `${xbuffer + (this.cards[i].dimensions.x * 2 * H) * (i % maxCols)}px`;
            cardCopy.style.top = `${(this.cards[i].dimensions.y * 2.1 * H) * Math.floor(i / maxCols)}px`;
            cardCopy.style.width = `${this.cards[i].dimensions.x * 2 * H}px`;
            cardCopy.style.height = `${this.cards[i].dimensions.y * 2 * H}px`;
            cardCopy.children[0].style.fontSize = `2vh`;
            cardCopy.children[1].style.fontSize = `1.5vh`;
            cardCopy.children[1].innerHTML = this.cards[i].fullDescription + "<br><br><span class='keyword'>" + this.cards[i].keywords + "</span>";
            cardCopy.style.zIndex = 20000;
            cardCopy.style.display = "block";
            let myId = this.cards[i].id;
            cardCopy.addEventListener("mousedown", function(e) {
                let pulledCard = null;
                for (let pull of usedCardArea.cards) if (pull.id === myId) pulledCard = pull;
                if (pulledCard === null) return;
                if (pulledCard.dragging && pulledCard.otherDragging) return;
                pulledCard.dragging = true;
                pulledCard.otherDragging = false;
                pulledCard.oldPosition = {x: mousePos.x/W, y: mousePos.y/H};
                pulledCard.rememberedMousePos = {x: mousePos.x, y: mousePos.y};
                pulledCard.sendUpdateRequest();
                usedCardArea.closeFullView();
            });
            cardCopy.addEventListener("mousemove", function(e) {
                hoveredQCard = [cardCopy, usedCardArea.cards[i]];
            });
            this.fullViewingElement.appendChild(cardCopy);
        }
    }

    // closes and cleans the card menu, and returns true if it was open
    closeFullView(resetQ = true) {
        if (!this.cardMenuOpen) return false;
        if (resetQ) hoveredQCard = [null, null];
        this.cardMenuOpen = false;
        this.fullViewingElement.style.display = "none";
        while (this.fullViewingElement.lastElementChild) {
            this.fullViewingElement.removeChild(this.fullViewingElement.lastElementChild);
        }
        return true;
    }

    // sends a request to the server to shuffle the deck
    shuffleRequest() {
        socket.talk(encodePacket(
            [
                protocol.server.shuffleArea,
                cardConversions[playerId].indexOf(this.id)
            ],
            ["int8", "int8"]
        ));
    }

    static byId(id) {
        for (let i = 0; i < cardAreas.length; i++) {
            if (cardAreas[i].id === id) return cardAreas[i];
        }
    }
}

async function fetchCardAreas() {
    let cardAreaSetup = await (await fetch("./json/cardAreaSetup.json")).json();
    for (let i = 0; i < cardAreaSetup.length; i++) {
        cardAreas.push(new CardArea(cardAreaSetup[i]));
    }
}
await fetchCardAreas();

// when we raise our mouse, drop any dragged cards
let spaceHeld = false;
document.addEventListener("mouseup", function(e) {
    for (let c = 0; c < cardAreas.length; c++) {
        if (cardAreas[c].hoveringCard === null || !cardAreas[c].mouseOver) continue;
        cardAreas[c].hoveringCard.cardArea.cards.splice(cardAreas[c].hoveringCard.cardArea.cards.indexOf(cardAreas[c].hoveringCard), 1);
        // check where we need to add it
        if (cardAreas[c].type === 1) {
            if (spaceHeld) cardAreas[c].cards.push(cardAreas[c].hoveringCard);
            else cardAreas[c].cards.splice(0, 0, cardAreas[c].hoveringCard);
        } else for (let i = 0; i <= cardAreas[c].cards.length; i++) {
            if (i >= cardAreas[c].cards.length) {
                cardAreas[c].cards.push(cardAreas[c].hoveringCard);
                break;
            }

            if (cardAreas[c].hoveringCard.position.x < cardAreas[c].cards[i].position.x) {
                cardAreas[c].cards.splice(i, 0, cardAreas[c].hoveringCard);
                break;
            }
        }
        
        cardAreas[c].refractory = 10;
        cardAreas[c].hoveringCard.cardArea.refractory = 10;
        cardAreas[c].hoveringCard.cardArea = cardAreas[c];
    }
    for (let c = 0; c < cardAreas.length; c++) for (let i = 0; i < cardAreas[c].cards.length; i++) {
        cardAreas[c].hoveringCard = null;
        if (cardAreas[c].cards[i].dragging && !cardAreas[c].cards[i].otherDragging) {
            cardAreas[c].cards[i].dragging = false;
            cardAreas[c].cards[i].otherDragging = true;
            cardAreas[c].cards[i].sendUpdateRequest();
        }
        else {
            cardAreas[c].cards[i].dragging = false;
            cardAreas[c].cards[i].otherDragging = true;
        }
    }
});

// our websocket connection
class Socket {
    constructor() {
        this.socket = null;
        this.connected = false;
        this.pingsocket = false;
    }

    connect() {
        if (this.socket !== null) return;
        this.socket = new WebSocket("wss://" + location.host + "/ws");
        this.socket.binaryType = "arraybuffer";
        this.socket.onopen = () => this.open();
        this.socket.onmessage = (data) => this.message(data);
        this.socket.onerror = (error) => this.error(error);
        this.socket.onclose = (reason) => this.close(reason);
        this.awaitLobbyFunction = null;
    }

    disconnect() {
        if (this.socket === null) return;
        this.socket.close();
        this.socket = null;
        this.connected = false;
    }

    talk(data) {
        if (this.socket === null) return;
        if (this.socket.readyState === 1) this.socket.send(data);
        else setTimeout(() => { this.talk(data) }, 100);
    }

    message(packet) {
        if (this.pingsocket) return;
        let reader = new DataView(packet.data);
        
        switch (reader.getInt8(0)) {
            case protocol.client.connected: {
                console.log(`Connection confirmed by server on port "${location.host}"`);
                this.connected = true;
                break;
            }
            case protocol.client.doesCodeExist: {
                let d = decodePacket(reader, ["int8", "int8"]);
                if (d[1] === 1) {
                    doc.frontPageSubmitButton.innerText = "Join Lobby";
                } else {
                    doc.frontPageSubmitButton.innerText = "Create Lobby";
                }
                break;
            }
            case protocol.client.fullLobbyUpdate: {
                doc.tableViewContainer.style.display = "block";
                doc.frontMenuContainer.style.display = "none";
              
                if (this.awaitLobbyFunction !== null) {
                  this.awaitLobbyFunction();
                  this.awaitLobbyFunction = null;
                }
                // 0:id, 1:lobby, 2:player#, 3: >areas, >cards, 0a:id, 1a:visual, 2a:posx, 3a:posy, 4a:flipped, 5a:inverted, 6a:dragging, <, <
                let d = decodePacket(reader, ["int8", "string", "int8", "repeat", "repeat", "int32", "int8", "float32", "float32", "int8", "float32array", "int8", "int8", "int8", "end", "end", "float32array", "repeat", "string", "end"]);
                // use the conversion chart to see what cards belong where
                let usedTable = cardConversions[d[2]];
                playerId = d[2];
                let fillIns = [];
                for (let i = 0; i < 22; i++) {
                    const t = CardArea.byId(usedTable[i]);
                    // unmark all cards in the first cycle
                    t.updateColors(d[5]);
                    if (t.refractory > 0) continue;
                    for (let c of t.cards) c.marked = false;
                  
                    // run through and mark cards when we find them
                    for (let j = 0; j < d[3][i].length; j += 9) {
                        let cardMatched = false;
                        for (let k = 0; k < t.cards.length; k++) {
                            let c = t.cards[k];
                            if (c.marked) continue;
                            if (c.id === d[3][i][j + 0]) {
                                cardMatched = true;
                                c.marked = true;
                                if (c.refractory > 0) {
                                    c.refractory--;
                                    continue;
                                }
                                c.flipped = !!d[3][i][j + 4];
                                c.visibility = d[3][i][j + 5];
                                c.inverted = !!d[3][i][j + 6];
                                /*if (!c.dragging)*/ c.dragging = d[3][i][j + 7];
                                if (c.dragging && c.otherDragging) {
                                    c.position.x = playerId >= 2 ? 1 - d[3][i][j + 2] : d[3][i][j + 2];
                                    c.position.y = playerId >= 2 ? 1 - d[3][i][j + 3] : d[3][i][j + 3];
                                }
                                // if the card is out of position, put it in position
                                if (t.cards.indexOf(c) !== d[3][i][j + 8]) {
                                    let pulledCard = t.cards.splice(k, 1)[0];
                                    t.cards.splice(d[3][i][j + 8], 0, pulledCard);
                                    k = 0;
                                    continue;
                                }
                                break;
                            }
                        }
                        if (!cardMatched) fillIns.push([t, d[3][i][j + 0], d[3][i][j + 1]]);
                    }
                }
                
                let unmarked = [];
                for (let i = 0; i < 22; i++) {
                    const t = CardArea.byId(usedTable[i]);
                    if (t.refractory > 0) {
                        t.refractory--;
                        continue;
                    }
                    for (let c of t.cards) if (!c.marked) unmarked.push(c);
                }
                for (let f of fillIns) {
                    let matched = false;
                    for (let u of unmarked) {
                        if (u.id === f[1]) {
                            matched = true;
                            f[0].addCard(u.cardArea.cards.splice(u.cardArea.cards.indexOf(u), 1)[0]);
                        }
                    }
                    if (!matched) f[0].addCard(new Card(f[1], findCard(f[2])));
                }
              
                // update mouse positions
                for (let i = 0; i < d[4].length; i += 2) {
                    let reversed = (playerId < 2 && i/2 >= 2) || (playerId >= 2 && i/2 < 2);
                    if (d[4][i + 0] === -1) {
                        mouseFollowers[i/2].style.display = "none";
                        continue;
                    } else mouseFollowers[i/2].style.display = "block";
                    mouseFollowers[i/2].style.left = `${reversed ? W - W * d[4][i + 0] : W * d[4][i + 0]}px`;
                    mouseFollowers[i/2].style.top = `${reversed ? H - H * d[4][i + 1] : H * d[4][i + 1]}px`;
                }
                break;
            }
            default: {
                console.log(`An unknown code has been recieved: ${reader.getInt8(0)}`);
                break;
            }
        }
    }

    open() {
        if (!this.pingsocket) console.log("Socket connected");
    }

    error(error) {
        console.error(error);
    }

    close(reason) {
        if (!this.pingsocket) {
            console.log(`Socket closed for reason:`);
            console.log(reason);
        }
    }
}

socket = new Socket();

doc.frontMenuCodeInput.addEventListener("input", function(e) {
    socket.talk(encodePacket([protocol.server.checkIfCodeExists, doc.frontMenuCodeInput.value], ["int8", "string"]));
});

socket.connect();
doc.frontPageSubmitButton.addEventListener("click", function(e) {
    if (!socket.connected) return;
    socket.talk(encodePacket([protocol.server.joinLobbyWithCode, doc.frontMenuCodeInput.value, doc.frontMenuNameInput.value], ["int8", "string", "string"]));
    console.log(`Requesting a lobby...`)
});

// an update loop to keep the game running
function update() {
    requestAnimationFrame(update);

    // update the position of all dragged cards
    let firstCard = true;
    let totalCards = 0;
    let cardIsDragging = false;
    for (let c = 0; c < cardAreas.length; c++) for (let i = 0; i < cardAreas[c].cards.length; i++) {
        totalCards++;
        if (cardAreas[c].cards[i].dragging && !cardAreas[c].cards[i].otherDragging) cardIsDragging = true;
    }

    for (let c = 0; c < cardAreas.length; c++) {
        let mouseOverCardArea = (
            mousePos.x > (cardAreas[c].AABB.xmin * W) &&
            mousePos.x < (cardAreas[c].AABB.xmax * W) &&
            mousePos.y > (cardAreas[c].AABB.ymin * H) &&
            mousePos.y < (cardAreas[c].AABB.ymax * H)
        );
        if (mouseOverCardArea) cardAreas[c].mouseOver = true;
        else cardAreas[c].mouseOver = false;

        for (let i = 0; i < cardAreas[c].cards.length; i++) {
            let card = cardAreas[c].cards[i];
            card.element.style.zIndex = totalCards;
            totalCards--;
            let mouseOver = (
                mousePos.x > (card.position.x * W) &&
                mousePos.x < (card.position.x * W) + card.pixelDimensions.width &&
                mousePos.y > (card.position.y * H) &&
                mousePos.y < (card.position.y * H) + card.pixelDimensions.height
            );

            if (mouseOver || (card.dragging && !card.otherDragging)) {
                card.mouseOver = true;
                card.mouseOnChecks(cardIsDragging ? (card.dragging && !card.otherDragging) : firstCard);
                firstCard = false;
            }
            else if (card.mouseOver == true) {
                card.mouseOver = false;
                card.mouseOffEvent();
            }
            if (card.dragging && !card.otherDragging) {
                card.element.style.zIndex = 1000;
                if (!card.otherDragging) card.snapToMouse();
                for (let a = 0; a < cardAreas.length; a++) {
                    cardAreas[a].hoveringCard = null;
                    cardAreas[a].checkSlotIn(card);
                }
            }
        }

        cardAreas[c].alignCards();
    }
}
requestAnimationFrame(update);

document.addEventListener("mousedown", function(e) {
    if (e.button === 2) alert(`The d100 rolled a ${Math.floor(Math.random() * 100) + 1}!`)
});

let hoveredQCard = [null, null];
document.addEventListener("keydown", function(e) {
    if (hoveredQCard[0] !== null && (e.key === "w" || e.key === "e")) {
        if (e.key === "w") hoveredQCard[1].flipped = !hoveredQCard[1].flipped;
        else if (
          hoveredQCard[1].visibility[0] == 1 ||
          hoveredQCard[1].visibility[1] == 1 ||
          hoveredQCard[1].visibility[2] == 1 ||
          hoveredQCard[1].visibility[3] == 1
        ) {
          hoveredQCard[1].flipForAll(false);
          hoveredQCard[1].flipped = false;
        } else {
          hoveredQCard[1].flipForAll(true);
          hoveredQCard[1].flipped = true;
        }
      
        for (let child of hoveredQCard[0].children) child.style.display = hoveredQCard[1].flipped ? "none" : "block";
        if (playerId === 0 || e.key === "e") hoveredQCard[0].style.borderTopColor = hoveredQCard[1].flipped ? "" : "var(--red)";
        if (playerId === 1 || e.key === "e") hoveredQCard[0].style.borderRightColor = hoveredQCard[1].flipped ? "" : "var(--blue)";
        if (playerId === 2 || e.key === "e") hoveredQCard[0].style.borderBottomColor = hoveredQCard[1].flipped ? "" : "var(--yellow)";
        if (playerId === 3 || e.key === "e") hoveredQCard[0].style.borderLeftColor = hoveredQCard[1].flipped ? "" : "var(--green)";
      
        hoveredQCard[1].sendUpdateRequest();
        return;
    }
    switch (e.key) {
        case " ": {
            spaceHeld = true;
            break;
        }
        case "q": {
            // close all full views
            let cancel = false;
            for (let i = 0; i < cardAreas.length; i++) {
                if (cardAreas[i].closeFullView()) cancel = true;
                for (let j = 0; j < cardAreas[i].cards.length; j++) if (cardAreas[i].cards[j].dragging && !cardAreas[i].cards[j].otherDragging) cancel = true;
            }
            // if dragging a card, ignore for now
            if (cancel) return;
            for (let i = 0; i < cardAreas.length; i++) {
                if (cardAreas[i].mouseOver) {
                    cardAreas[i].showFullView();
                    return;
                }
            }
            break;
        }
        case "w": case "e": {
            // flip any selected cards
            let mouseOverFlip = true;
            for (let i = 0; i < cardAreas.length; i++) for (let j = 0; j < cardAreas[i].cards.length; j++) {
                if (cardAreas[i].cards[j].dragging && !cardAreas[i].cards[j].otherDragging) {
                    if (e.key === "e" && spaceHeld) {
                        let allUp = true;
                        for (let card of cardAreas[i].cards) if (!card.flipped) allUp = false;
                        for (let card of cardAreas[i].cards) {
                            card.flipForAll(!allUp);
                        }
                    }
                    else if (e.key === "e") {
                        if (
                          cardAreas[i].cards[j].visibility[0] == 1 ||
                          cardAreas[i].cards[j].visibility[1] == 1 ||
                          cardAreas[i].cards[j].visibility[2] == 1 ||
                          cardAreas[i].cards[j].visibility[3] == 1
                        ) cardAreas[i].cards[j].flipForAll(false);
                        else cardAreas[i].cards[j].flipForAll(true);
                    }
                    else {
                        cardAreas[i].cards[j].flipped = !cardAreas[i].cards[j].flipped;
                        cardAreas[i].cards[j].sendUpdateRequest();
                    }
                    mouseOverFlip = false;
                }
            }
            if (mouseOverFlip) for (let i = 0; i < cardAreas.length; i++) for (let j = 0; j < cardAreas[i].cards.length; j++) {
                if (cardAreas[i].cards[j].mouseOver) {
                    if (e.key === "e" && spaceHeld) {
                        let allUp = true;
                        for (let card of cardAreas[i].cards) if (!card.flipped) allUp = false;
                        for (let card of cardAreas[i].cards) {
                            card.flipForAll(!allUp);
                        }
                    }
                    else if (e.key === "e") {
                        if (
                          cardAreas[i].cards[j].visibility[0] == 1 ||
                          cardAreas[i].cards[j].visibility[1] == 1 ||
                          cardAreas[i].cards[j].visibility[2] == 1 ||
                          cardAreas[i].cards[j].visibility[3] == 1
                        ) cardAreas[i].cards[j].flipForAll(false);
                        else cardAreas[i].cards[j].flipForAll(true);
                    }
                    else {
                        cardAreas[i].cards[j].flipped = !cardAreas[i].cards[j].flipped;
                        cardAreas[i].cards[j].sendUpdateRequest();
                    }
                    break;
                }
            }
            break;
        }
        case "a": {
            // invert any selected cards
            let mouseOverFlip = true;
            for (let i = 0; i < cardAreas.length; i++) for (let j = 0; j < cardAreas[i].cards.length; j++) {
                if (cardAreas[i].cards[j].dragging && !cardAreas[i].cards[j].otherDragging) {
                    cardAreas[i].cards[j].inverted = !cardAreas[i].cards[j].inverted;
                    mouseOverFlip = false;
                    cardAreas[i].cards[j].sendUpdateRequest();
                }
            }
            if (mouseOverFlip) for (let i = 0; i < cardAreas.length; i++) for (let j = 0; j < cardAreas[i].cards.length; j++) {
                if (cardAreas[i].cards[j].mouseOver) {
                    cardAreas[i].cards[j].inverted = !cardAreas[i].cards[j].inverted;
                    cardAreas[i].cards[j].sendUpdateRequest();
                    break;
                }
            }
            break;
        }
        case "s": {
            // shuffle the hovered deck
            for (let i = 0; i < cardAreas.length; i++) {
                if (!cardAreas[i].mouseOver) continue;
                if (!confirm("Confirm Deck Shuffle")) break;
                cardAreas[i].shuffleRequest();
            }
            break;
        }
        case "p": {
            if (!spaceHeld) break;
            socket.disconnect();
            socket.connect();
            setTimeout(function(e) {
                socket.awaitLobbyFunction = function() {
                    for (let i = 0; i < cardAreas.length; i++) for (let j = 0; j < cardAreas[i].cards.length; j++) {
                        cardAreas[i].cards[j].sendUpdateRequest();
                    }
                }
                socket.talk(encodePacket([protocol.server.joinLobbyWithCode, doc.frontMenuCodeInput.value, doc.frontMenuNameInput.value], ["int8", "string", "string"]));
            }, 1000);
            break;
        }
        case "o": {
            if (!spaceHeld) break;
            let player = prompt("type which player (0, 1, 2, or 3) to remove");
            if (player !== "1" && player !== "2" && player !== "3" && player !== "0") break;
            socket.talk(encodePacket([protocol.server.removePlayer, parseInt(player)], ["int8", "int8"]));
            break;
        }
    }
});

document.addEventListener("keyup", function(e) {
    switch (e.key) {
        case " ": {
            spaceHeld = false;
            break;
        }
    }
});


// for our render hosting, we need to do this to keep the project active
function pingRender() {
    let pingsocket = new Socket();
    pingsocket.connect();
    pingsocket.pingsocket = true;
    setTimeout(function(e) {
        pingsocket.disconnect();
        pingsocket = null;
    }, 1000);
}
setInterval(pingRender, 5 * 1000);