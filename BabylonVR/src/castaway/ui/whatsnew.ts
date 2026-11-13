// "What's new" on the main menu: the game's big additions, newest first. Every update worth telling players about gets an
// entry at the TOP of this list (a date, a headline, a few short lines). The newest entry's date also decides whether the
// menu button shows its "new" dot (until the player has opened the page).

export interface Update { date: string; title: string; items: string[] }

export const UPDATES: Update[] = [
    {
        date: "2026-12-04", title: "A new castaway: Bora",
        items: [
            "Character now has a Body choice: the classic castaway, or Bora, an old islander with white hair, a beard and tattoos.",
            "Choose his hair colour, skin tone, a full, short or no beard, and the colour of his shorts (Trouser colour). Everyone in the game sees him as you chose him.",
            "He walks, swims, sits and swings tools like everyone else. Shirts, trousers, hats and bags for Bora are on their way.",
        ],
    },
    {
        date: "2026-12-03", title: "A livelier sky, a raft that rows in the water",
        items: [
            "The clouds gather in banks with wide spells of clear blue between them, the weather drifts between fair and cloudier over time, the big clouds are grey underneath and bright on top, and thin high streaks of cirrus cross the sky.",
            "The raft's oar now reaches well down into the water.",
            "Rafts and boats leave a wake of rings in the water behind them as they move, just like you do when wading.",
        ],
    },
    {
        date: "2026-12-02", title: "Swipe through the crafting list",
        items: [
            "On a phone or tablet, swipe up and down anywhere on the crafting list to scroll it (no more aiming for the scroll bar). A swipe never crafts the row it started on.",
            "Edge smoothing (FXAA) is back on by default on the phone settings.",
        ],
    },
    {
        date: "2026-12-01", title: "Quieter birds, a tidier Settings page",
        items: [
            "No more beep-beep-beep from birds you could not see: the little birds hidden in the trees no longer sing. They still flutter off when you come close.",
            "The Settings page fits phone screens again: its options stack in one column when two do not fit.",
        ],
    },
    {
        date: "2026-11-30", title: "Phones start again",
        items: [
            "Fixed the game freezing on its first frame on phones and tablets: the warm-up before Play no longer looks all round at once there, and edge smoothing is off by default on the phone settings (you can still turn it on in Graphics).",
        ],
    },
    {
        date: "2026-11-29", title: "Lighter on phones",
        items: [
            "The islets' trees and rocks are only made once you sail near them, so the game needs much less memory at the start. This should stop the freeze or black screen some phones showed after pressing Play.",
        ],
    },
    {
        date: "2026-11-28", title: "Supplies in the Arctic",
        items: [
            "Frozen logs lie about on the Arctic's snow: pick them up for wood, so you can keep a fire going up north.",
            "You will find frozen meat out there too. It is no good raw: thaw and cook it on a campfire.",
            "What you take comes back after a while, so the Arctic never runs dry.",
        ],
    },
    {
        date: "2026-11-27", title: "Stock up on the islets, a real storm at sea",
        items: [
            "The little islets out at sea now grow real palm trees, just like the island's: fell them for wood. The bigger islets have a good stand of them, with boulders to mine and now and then a seam of metal ore.",
            "Coconuts lie under the islet palms (and a felled palm drops more), so a long voyage can top up on food and drink.",
            "Waves no longer wash across your raft's deck: the sea stays below the logs, however rough it gets.",
            "The storm past the reef is a proper storm now: the sky goes black as the waves build, the sea darkens with it, and lightning and thunder come thick and fast.",
            "Fixed a strange see-through look on wave crests taller than your eyes.",
        ],
    },
    {
        date: "2026-11-26", title: "A readable menu, a smoother start",
        items: [
            "The menu on a PC is bigger on large screens and its buttons finally have proper, readable labels (in VR too).",
            "Before Play is offered the game now takes a look all round your spot and opens the menu once behind the loading screen, so the first seconds of play and the first time you open the menu run smoothly.",
            "The version number shows on the main menu straight away.",
        ],
    },
    {
        date: "2026-11-25", title: "Swim anywhere",
        items: [
            "You can swim anywhere on the sea now: from a wreck back to your raft, out to an islet, wherever you like. (Swimming out past the reef without a boat still brings the storm.)",
        ],
    },
    {
        date: "2026-11-24", title: "Mouse look fixed",
        items: [
            "Mouse look works again in Edge and Chrome. The game no longer switches to fullscreen by itself (that was taking the mouse away again).",
            "Want Ctrl+W to stay in the game? Turn on \"Fullscreen while playing\" in Settings: in fullscreen the game keeps those keys. Otherwise the browser asks before the tab closes.",
        ],
    },
    {
        date: "2026-11-23", title: "Faster rafts, solid reefs",
        items: [
            "Rafts row half as fast again: the open sea is a lot less of a slog.",
            "Shipwrecks lie on real reefs now, a sandy shelf you can swim down to, and the sea floor goes on under you wherever you sail: nothing floats in the deep any more.",
            "If your computer resets its graphics (it can happen when you switch away or take a screenshot), the game saves, tells you, and reloads by itself instead of freezing. If loading ever gets stuck, the loading screen tells you what to do.",
        ],
    },
    {
        date: "2026-11-22", title: "Smoother start, safer keys",
        items: [
            "The loading screen now waits until everything round you is built and running smoothly before it offers Play: no more stutter in your first seconds.",
            "On a PC the game goes fullscreen when you play and keeps the keys for itself, so Ctrl+W (crouching forward) no longer closes the tab. If the tab is about to close anyway, the browser asks first.",
        ],
    },
    {
        date: "2026-11-21", title: "Raft fixes",
        items: [
            "The compass on your raft is always recognised, for every player and after loading a save, so the storm past the reef can't sweep you away when you have one aboard.",
            "Furnaces, workbenches and other stone or wooden things set on a raft keep their look as you sail: no more textures sliding over them.",
        ],
    },
    {
        date: "2026-11-20", title: "Sail any way you like",
        items: [
            "No more invisible wall: sail away from the island in any direction. Whichever way you go you meet the same journey: the storm past the reef, the islets and wrecks, drift ice, the icebergs and their storm, and in the end the Arctic, which now rings the whole sea.",
            "The storm past the reef lasts longer: a good 200 metres of rough sea before it eases.",
            "No more messages telling you the storms are easing: the sky and the sea show it.",
        ],
    },
    {
        date: "2026-11-19", title: "A tidier crafting menu",
        items: [
            "Everything you can make by hand, without a workbench, is now listed first as Essentials. The workbench recipes follow, by kind.",
        ],
    },
    {
        date: "2026-11-18", title: "Music, and a storm among the icebergs",
        items: [
            "A new instrument: the Flute. In VR bring it to your lips and squeeze the right trigger to blow (softly or hard); X, Y and the left trigger are your fingers for eight notes, the left grip plays higher. On a screen hold the mouse button and press 1-8. Everybody hears you play.",
            "The guitar sounds much better: a real wooden body, a soft room round it, gentle strums mellow and hard ones bright.",
            "The drum answers how you play it: a soft tap is a quiet thud, a slam a big boom, and hitting nearer the rim rings higher, so you can play a tune on it.",
            "Sailing north, a second storm blows up as you reach the big icebergs and clears before the Arctic. On the way home you meet it again.",
        ],
    },
    {
        date: "2026-11-17", title: "Fly your own flag",
        items: [
            "Craft a Flag at the workbench: a tall pole flying a white flag. Set it up anywhere, on your raft or boat too, and sail away under it.",
            "Press E on it to paint your own flag, just like a picture (in VR, paint straight onto the cloth). Everybody sees it, and it is saved with your world.",
        ],
    },
    {
        date: "2026-11-16", title: "Into the frozen north",
        items: [
            "Sail north past the islets (follow the N on your compass) and the air turns cold. First little floes of drift ice, then icebergs: sharp peaks with huge white bulks hidden under the water, and flat-topped bergs taller than a house. Steer between them, they are solid!",
            "Keep going, a long way, and you reach the Arctic: ice cliffs, a snowy plateau, deep blue crevices and clear melt pools you can drink from.",
            "Penguins live along its shore, huddled together with their fluffy grey chicks. They are friendly: walk up and they look up at you, flap and call.",
            "It snows up there, and the ice glints and glows blue in the sun. The way home is always back south: the little house on your compass shows it.",
        ],
    },
    {
        date: "2026-11-15", title: "The compass and the open sea",
        items: [
            "Craft a Compass at the workbench and set it on your raft or boat. Its card always points north, a little red house shows the way home, and a screen says how far the island is.",
            "With a compass aboard, the storm past the reef no longer ends your trip: hold your course and it blows itself out, the sun comes back and the sea calms down.",
            "Out on the open sea: small islets with palms, rocks and sometimes a buried chest, and old shipwrecks on the reefs with treasure in the hold. Swim up to a chest and press E.",
            "Seagulls wheel over the islets, whales come by now and then, and the weather out there turns rough and calm like it does at home.",
        ],
    },
    {
        date: "2026-11-14", title: "The deep, smoother edges and the sub",
        items: [
            "Smooth edges: a new anti-aliasing setting in Graphics (off, FXAA, MSAA 4x or max). High uses max.",
            "Deep sea creatures fade in and out instead of popping up, and their lights really glow in the dark.",
            "The drifting specks in the water stay dim in the dark and only light up in a floodlight's beam, and never float inside a submarine.",
            "Explore the deep as far as you like. The driver's screen shows your depth in metres.",
            "A surfaced submarine rides a little higher: through the top of the window you see the sky and the sea, below the waterline the water.",
            "Placing a submarine finds the nearest water deep enough along where you aim, so the preview goes green.",
            "Other players' hammering and mining sounds come from where they are. Menus no longer leave your body behind in a submarine.",
            "VR: hands join up with the arms. Ctrl and Shift no longer trigger browser shortcuts while you drive.",
        ],
    },
    {
        date: "2026-11-13", title: "Butterflies and better flowers",
        items: [
            "Butterflies in many colours flutter about the island by day, and settle on the grass now and then.",
            "Hibiscus grows as a little shrub with woody stems and big open flowers; poppies open wide with their black middles.",
            "Rafts: the preview turns green where a raft or a piece can go and red where it can't, and building on a raft no longer stalls.",
            "A tidier furnace view: its fuel and slots in one card, what goes in and what comes out, and your bag in one place with your gear beside it.",
            "Crafting cards fit every ingredient, even for the submarine.",
        ],
    },
    {
        date: "2026-11-12", title: "Fuel, gear and fixes",
        items: [
            "Furnaces and campfires show their fuel in the menu, with +1 Wood and +1 Coal buttons to feed them from your bag.",
            "Gear slots in the bag: see your helmet, chest and legs armour and how much they protect you; wear or take off from there.",
            "Torches, lanterns and fires stay lit and glowing from far away: you can see your house at night across the island.",
            "Desert: sand you heap or dig keeps its shape however far you walk away. Sandstorms now last about half a minute.",
            "The parachute and its readout go away when you land. The menu is a sensible size on big screens, and the Graphics page no longer shows over the Map.",
            "Windows: no more flicker where the frame meets the wall.",
        ],
    },
    {
        date: "2026-11-11", title: "Smoother, and a clearer menu",
        items: [
            "Runs much faster on high settings: the sea's reflection and the shadows no longer draw what they can't see, and far less work is redone every frame.",
            "On a computer or phone the menu is a flat, bright panel on the screen, the same however you are looking.",
            "Windows no longer flicker round their frames.",
            "VR: other players now see your tool exactly as you hold it, pointing and tilting with your hand.",
            "VR: the heads-up display (vitals, hotbar, hints) is sharper, bigger, nearer the middle of your view and turned to face you, with brighter, clearer text.",
        ],
    },
    {
        date: "2026-11-10", title: "The deep",
        items: [
            "Past the reef the sea floor now drops down a wall into the abyss, about 100 m deep, where the daylight dies away to black.",
            "Submarines have floodlights at the bow and stern: press the button at the top left of the console to switch them on.",
            "Deep sea life that glows in the dark: lantern fish, jellyfish, squid and anglerfish.",
            "VR: drive the submarine with the sticks. The left stick takes it up and down and slides it sideways, the right stick steers and drives it.",
            "Treasure chests lie on the floor of the abyss. Bring the submarine close and anyone inside can press E to loot it. They fill up again after a while.",
        ],
    },
    {
        date: "2026-11-09", title: "Submarines, and homes on rafts",
        items: [
            "Build a submarine at the workbench and put it in deep water: a yellow sub with a glass dome, four seats and a hatch on top.",
            "Climb in at the surface and everybody gets a seat. The driver sails it from the console and takes it down to the reef and back up. Deep down, the storm can't reach you.",
            "Rafts: no more gap under the walls. Beds, doors, pictures, torches on the railing posts, lanterns under an upper floor and the rest all work on a raft and sail with it.",
        ],
    },
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
