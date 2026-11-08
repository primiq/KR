// "What's new" on the main menu: the game's big additions, newest first. Every update worth telling players about gets an
// entry at the TOP of this list (a date, a headline, a few short lines). The newest entry's date also decides whether the
// menu button shows its "new" dot (until the player has opened the page).

export interface Update { date: string; title: string; items: string[] }

export const UPDATES: Update[] = [
    {
        date: "2026-11-08", title: "Rafts",
        items: [
            "Craft a raft from wood and fiber (no workbench needed) and put it on the sea.",
            "Build on it with the building plan like on land: more raft sections, walls, doorways, windows, railings, a floor above and stairs up to it.",
            "Steer it with the oar at the back. Sail too far out and the storm comes for it; after the giant wave it washes up off the beach, ready to go again.",
            "Fixes: the rug shows its pattern, big houses run much smoother, raised pools no longer open a hole in the ground, the desert ground shows on Quest, the VR pointer shows over the menu, the host's dropped items show for everyone, and legs stand still on a moving boat.",
        ],
    },
    {
        date: "2026-11-06", title: "Swim in the lava",
        items: [
            "Floris Lava: fall in and you can swim in the lava - dive under and everything glows orange.",
            "The lava and its geysers no longer hurt you. Only the eruption does.",
        ],
    },
    {
        date: "2026-11-04", title: "Floris Lava, sand worms and one menu everywhere",
        items: [
            "New door in the secret room: Floris Lava. Climb a jumping course up the walls of a volcano's caldera while the lava rises.",
            "Press START at the bottom; stop your clock in the research station at the top. Everybody sees everybody's times.",
            "Escape in the rescue helicopter and watch the volcano blow into a mushroom cloud. Ledges to fall onto, a board of results in the secret room.",
            "The Desert: far out in the dunes, giant sand worms burst out of the sand and dive back in.",
            "The VR menu board (Bag, Craft, Map, Chat, Multiplayer, Graphics) is now the menu on desktop and mobile too.",
            "VR arms move like arms: elbows, shoulders and chest follow your hands.",
            "The loading screen stays until the game runs smoothly; darker nights; no more flickering wood on buildings.",
        ],
    },
    {
        date: "2026-11-03", title: "A new look for the menu board",
        items: [
            "Crafting in two columns of cards, with what you have and what you need at a glance.",
            "Cleaner Bag tab with your hotbar marked; the Menu tab is now Multiplayer.",
            "A much smaller download and a faster start.",
        ],
    },
    {
        date: "2026-11-01", title: "Oasis life, pools and a classier secret room",
        items: [
            "The Desert: sandstorms (shelter in your buildings), drinking at the oasis, a lush lawn, big holes dug fast.",
            "Deep pools filled with sea water, and level ground under buildings in the desert.",
            "The secret room is now a long, grand hallway with room for more doors.",
            "A guitar with real strings to pick or strum in VR; flamingos that walk about.",
            "VR: easier boarding, boats you can walk on, better hands, held items and a red pointer.",
            "Friends can rejoin cleanly, and the room carries on if the host leaves.",
        ],
    },
    {
        date: "2026-10-31", title: "The Desert",
        items: [
            "New door in the secret room: an oasis in endless dunes. Dig channels to bring water out and turn the sand green; plant saplings on the green.",
            "Sun loungers and a drum to build.",
            "A new main menu with graphics settings, on screen and in VR.",
            "Open the island you are playing to friends from any device; multiplayer in a headset goes straight into VR.",
            "VR: your own hands and an easy wrist menu.",
        ],
    },
    {
        date: "2026-10-30", title: "Storms and a richer island",
        items: [
            "Storms you can watch build out at sea, and a giant wave you see coming.",
            "Granite boulders, shining metal ore, leafy bushes with berries.",
            "Railings with torches; see your own body when you look down.",
            "Runs much better on standalone headsets like the Quest.",
        ],
    },
    {
        date: "2026-10-29", title: "Castaway arrives",
        items: [
            "Survive on a tropical island: gather, craft, build, fish, cook and sleep - alone or with friends, on screen or in VR.",
            "Wildlife, weather, caves to dig into, shipwrecks with chests, sailing boats and the storm at sea.",
            "The secret room and its doors: the airstrip, the cat house, Hideaway Isle, the Chamber of Tiles, Banana or Salmon, Locations, and the cloud-door skydive.",
            "The stone circle, Mario's warp pipe, the alien invasion, the giant water slide - and paint pictures to hang on your walls.",
        ],
    },
];

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const nice = (d: string) => { const [y, m, day] = d.split("-").map(Number); return `${day} ${MONTHS[m - 1]} ${y}`; };

/** fill the "What's new" page */
export function renderWhatsNew(el: HTMLElement) {
    el.textContent = "";
    UPDATES.forEach((u, i) => {
        const card = document.createElement("article");
        card.className = "wn-entry" + (i === 0 ? " latest" : "");
        const h = document.createElement("div");
        h.className = "wn-head";
        const date = document.createElement("span"); date.className = "wn-date"; date.textContent = nice(u.date);
        const t = document.createElement("h3"); t.textContent = u.title;
        h.append(date, t);
        const ul = document.createElement("ul");
        for (const it of u.items) { const li = document.createElement("li"); li.textContent = it; ul.appendChild(li); }
        card.append(h, ul);
        el.appendChild(card);
    });
}

/** the newest update's date (the button's "new" dot shows until the player has seen it) */
export const LATEST = UPDATES[0].date;
