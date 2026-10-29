import { Mesh, MeshBuilder, type Scene, Vector3, type WebXRInputSource } from "@babylonjs/core";
import { AdvancedDynamicTexture, Button, Control, Grid, Image, Rectangle, ScrollViewer, StackPanel, TextBlock } from "@babylonjs/gui";
import type { Game } from "../game/game";
import { ITEMS, type ItemId } from "../game/items";
import { canAfford, costHave, costLabel, GROUP_LABEL, RECIPES } from "../game/recipes";

const iconCache = new Map<string, string>();
/** Castaway's item icons are inline SVG: as data URLs they work as GUI images. */
export function iconUrl(id: ItemId): string {
    let u = iconCache.get(id);
    if (!u) {
        const svg = ITEMS[id].icon.replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" ');
        u = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
        iconCache.set(id, u);
    }
    return u;
}

const BG = "#0b1a22d8", SLOT = "#ffffff1f", SEL = "#ffd166", TXT = "#f4efe2";

function slotControl(name: string, size: number): { root: Button; img: Image; cnt: TextBlock; key?: TextBlock } {
    const root = Button.CreateSimpleButton(name, "");
    root.width = `${size}px`;
    root.height = `${size}px`;
    root.cornerRadius = 14;
    root.thickness = 3;
    root.color = "#ffffff30";
    root.background = SLOT;
    const img = new Image(`${name}i`, "");
    img.width = "78%";
    img.height = "78%";
    img.stretch = Image.STRETCH_UNIFORM;
    root.addControl(img);
    const cnt = new TextBlock(`${name}c`, "");
    cnt.color = TXT;
    cnt.fontSize = size * 0.26;
    cnt.fontWeight = "bold";
    cnt.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
    cnt.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
    cnt.paddingRight = "8px";
    cnt.paddingBottom = "4px";
    cnt.outlineWidth = 4;
    cnt.outlineColor = "#000";
    root.addControl(cnt);
    return { root, img, cnt };
}

/**
 * Castaway's HUD and bag for the headset, in Babylon GUI: a wrist display on the left hand (vitals, hotbar, what you
 * are looking at, messages) and a floating bag / crafting panel you point at with the right hand's laser. Both read
 * the same Hud state as the flat-screen HTML overlay and call the same actions, so they always agree.
 */
export class VRPanel {
    private wrist: Mesh;
    private wristUI: AdvancedDynamicTexture;
    private board: Mesh;
    private boardUI: AdvancedDynamicTexture;
    private vit: { fill: Rectangle; label: TextBlock }[] = [];
    private hot: ReturnType<typeof slotControl>[] = [];
    private prompt: TextBlock;
    private notes: TextBlock;
    private noteList: { t: string; at: number }[] = [];
    private grid: ReturnType<typeof slotControl>[] = [];
    private cont: ReturnType<typeof slotControl>[] = [];
    private contBox: StackPanel;
    private contTitle: TextBlock;
    private detail: TextBlock;
    private actions: Button[] = [];
    private bagPane: Grid;
    private craftPane: ScrollViewer;
    private craftList: StackPanel;
    private tabBag: Button;
    private tabCraft: Button;
    private dirty = true;
    private tabMenu: Button;
    private menuOpen = false;
    private menuPane!: StackPanel;
    private menuStatus!: TextBlock;
    private codeText!: TextBlock;
    private code = "";
    /** filled in by the page: multiplayer and session actions for the in-headset menu */
    menuActions: {
        status(): string;
        host(): Promise<string | null>;
        join(code: string): Promise<string | null>;
        leave(): void;
        save(): void;
        exitVR(): void;
    } | null = null;
    private craftKey = "";

    constructor(private readonly scene: Scene, private readonly game: Game) {
        // ---- wrist
        this.wrist = MeshBuilder.CreatePlane("vrWrist", { width: 0.2, height: 0.125 }, scene);
        this.wrist.isPickable = false;
        this.wrist.setEnabled(false);
        this.wrist.renderingGroupId = 1;
        this.wristUI = AdvancedDynamicTexture.CreateForMesh(this.wrist, 1024, 640, false);
        const w = new Rectangle("wbg");
        w.background = BG;
        w.cornerRadius = 40;
        w.thickness = 0;
        this.wristUI.addControl(w);
        const col = new StackPanel("wcol");
        col.paddingTop = "26px";
        w.addControl(col);
        const vitals = new Grid("vit");
        vitals.height = "70px";
        vitals.width = "960px";
        for (let i = 0; i < 4; i++) vitals.addColumnDefinition(0.25);
        const colors = ["#e85d5d", "#e8a13a", "#4fb3e8", "#f2d24a"];
        const names = ["Health", "Food", "Water", "Stamina"];
        for (let i = 0; i < 4; i++) {
            const bar = new Rectangle(`vb${i}`);
            bar.height = "44px";
            bar.width = "220px";
            bar.cornerRadius = 22;
            bar.thickness = 0;
            bar.background = "#ffffff22";
            const fill = new Rectangle(`vf${i}`);
            fill.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            fill.background = colors[i];
            fill.thickness = 0;
            fill.cornerRadius = 22;
            bar.addControl(fill);
            const label = new TextBlock(`vl${i}`, names[i]);
            label.color = TXT;
            label.fontSize = 26;
            label.fontWeight = "bold";
            label.outlineWidth = 4;
            label.outlineColor = "#0008";
            bar.addControl(label);
            vitals.addControl(bar, 0, i);
            this.vit.push({ fill, label });
        }
        col.addControl(vitals);
        const hot = new StackPanel("hot");
        hot.isVertical = false;
        hot.height = "170px";
        for (let i = 0; i < game.inv.hotbar; i++) {
            const s = slotControl(`h${i}`, 140);
            s.root.paddingLeft = "8px";
            s.root.paddingRight = "8px";
            s.root.width = "156px";
            hot.addControl(s.root);
            this.hot.push(s);
        }
        col.addControl(hot);
        this.prompt = new TextBlock("prompt", "");
        this.prompt.height = "150px";
        this.prompt.color = TXT;
        this.prompt.fontSize = 38;
        this.prompt.textWrapping = true;
        this.prompt.paddingLeft = "30px";
        this.prompt.paddingRight = "30px";
        col.addControl(this.prompt);
        this.notes = new TextBlock("notes", "");
        this.notes.height = "200px";
        this.notes.color = "#ffe9a8";
        this.notes.fontSize = 32;
        this.notes.textWrapping = true;
        this.notes.paddingLeft = "30px";
        this.notes.paddingRight = "30px";
        this.notes.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        col.addControl(this.notes);
        game.hud.onNote = (t) => {
            this.noteList.push({ t, at: performance.now() });
            if (this.noteList.length > 3) this.noteList.shift();
        };

        // ---- the bag / crafting board
        this.board = MeshBuilder.CreatePlane("vrBoard", { width: 1.1, height: 0.75 }, scene);
        this.board.setEnabled(false);
        this.board.renderingGroupId = 1;
        this.boardUI = AdvancedDynamicTexture.CreateForMesh(this.board, 1650, 1125, true);
        const b = new Rectangle("bbg");
        b.background = BG;
        b.cornerRadius = 40;
        b.thickness = 0;
        this.boardUI.addControl(b);
        const top = new StackPanel("tabs");
        top.isVertical = false;
        top.height = "110px";
        top.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        top.paddingTop = "20px";
        const tab = (name: string, label: string, fn: () => void) => {
            const t = Button.CreateSimpleButton(name, label);
            t.width = "260px";
            t.height = "80px";
            t.color = TXT;
            t.fontSize = 40;
            t.cornerRadius = 20;
            t.thickness = 0;
            t.paddingLeft = "10px";
            t.paddingRight = "10px";
            t.onPointerUpObservable.add(fn);
            top.addControl(t);
            return t;
        };
        this.tabBag = tab("tbag", "Bag", () => { this.menuOpen = false; game.hud.setTab("bag"); this.dirty = true; });
        this.tabCraft = tab("tcraft", "Craft", () => { this.menuOpen = false; game.hud.setTab("craft"); this.dirty = true; });
        this.tabMenu = tab("tmenu", "Menu", () => { this.menuOpen = true; this.dirty = true; });
        tab("tclose", "Close  ✕", () => this.close());
        b.addControl(top);

        this.bagPane = new Grid("bag");
        this.bagPane.top = "110px";
        this.bagPane.height = "1000px";
        this.bagPane.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        this.bagPane.addColumnDefinition(0.62);
        this.bagPane.addColumnDefinition(0.38);
        b.addControl(this.bagPane);
        const left = new StackPanel("left");
        this.bagPane.addControl(left, 0, 0);
        this.contBox = new StackPanel("cont");
        this.contTitle = new TextBlock("ctitle", "");
        this.contTitle.height = "60px";
        this.contTitle.color = TXT;
        this.contTitle.fontSize = 36;
        this.contBox.addControl(this.contTitle);
        const contRow = new StackPanel("crow");
        contRow.isVertical = false;
        contRow.height = "150px";
        for (let i = 0; i < 12; i++) {
            const s = slotControl(`c${i}`, 116);
            s.root.width = "124px";
            s.root.paddingLeft = "4px";
            s.root.paddingRight = "4px";
            s.root.onPointerUpObservable.add(() => { game.hud.slotClick(1, i); this.dirty = true; });
            contRow.addControl(s.root);
            this.cont.push(s);
        }
        this.contBox.addControl(contRow);
        left.addControl(this.contBox);
        const g = new Grid("slots");
        g.height = "600px";
        g.width = "960px";
        for (let i = 0; i < 6; i++) g.addColumnDefinition(1 / 6);
        for (let r = 0; r < 4; r++) g.addRowDefinition(0.25);
        for (let i = 0; i < game.inv.size; i++) {
            const s = slotControl(`g${i}`, 140);
            if (i < game.inv.hotbar) s.root.color = "#ffd16655";
            s.root.onPointerUpObservable.add(() => { game.hud.slotClick(0, i); this.dirty = true; });
            g.addControl(s.root, Math.floor(i / 6), i % 6);
            this.grid.push(s);
        }
        left.addControl(g);
        const right = new StackPanel("right");
        right.paddingRight = "30px";
        this.bagPane.addControl(right, 0, 1);
        this.detail = new TextBlock("detail", "Point at an item and pull the trigger.");
        this.detail.height = "520px";
        this.detail.color = TXT;
        this.detail.fontSize = 34;
        this.detail.textWrapping = true;
        this.detail.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        right.addControl(this.detail);
        const act = (name: string, fn: () => void) => {
            const a = Button.CreateSimpleButton(name, name);
            a.height = "96px";
            a.color = TXT;
            a.background = "#2d6a5a";
            a.fontSize = 38;
            a.cornerRadius = 20;
            a.thickness = 0;
            a.paddingTop = "10px";
            a.onPointerUpObservable.add(() => { fn(); this.dirty = true; });
            right.addControl(a);
            this.actions.push(a);
            return a;
        };
        act("Use", () => game.hud.actUse());
        act("Drop 1", () => game.hud.actDrop(false));
        act("Drop all", () => game.hud.actDrop(true));
        act("Move", () => game.hud.actXfer());

        this.craftPane = new ScrollViewer("craft");
        this.craftPane.top = "120px";
        this.craftPane.height = "980px";
        this.craftPane.width = "1580px";
        this.craftPane.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        this.craftPane.thickness = 0;
        this.craftPane.barSize = 30;
        this.craftList = new StackPanel("craftList");
        this.craftPane.addControl(this.craftList);
        b.addControl(this.craftPane);

        this.buildMenu(b);
        game.inv.subscribe(() => (this.dirty = true));
        game.worn.subscribe(() => (this.dirty = true));
    }

    /** The in-headset game menu: host or join a room (with a keypad for the code), save, leave VR. */
    private buildMenu(b: Rectangle) {
        const pane = new StackPanel("menu");
        pane.top = "120px";
        pane.width = "1500px";
        pane.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        b.addControl(pane);
        this.menuPane = pane;
        this.menuStatus = new TextBlock("mstatus", "");
        this.menuStatus.height = "130px";
        this.menuStatus.color = TXT;
        this.menuStatus.fontSize = 38;
        this.menuStatus.textWrapping = true;
        pane.addControl(this.menuStatus);
        const row = (h = 110) => {
            const r = new StackPanel("mrow");
            r.isVertical = false;
            r.height = `${h}px`;
            pane.addControl(r);
            return r;
        };
        const button = (parent: StackPanel, label: string, w: number, fn: () => void, bg = "#2d6a5a") => {
            const x = Button.CreateSimpleButton(`m${label}`, label);
            x.width = `${w}px`;
            x.height = "92px";
            x.color = TXT;
            x.fontSize = 36;
            x.cornerRadius = 20;
            x.thickness = 0;
            x.background = bg;
            x.paddingLeft = "8px";
            x.paddingRight = "8px";
            x.onPointerUpObservable.add(() => { fn(); this.dirty = true; });
            parent.addControl(x);
            return x;
        };
        const say = (t: string | null) => { if (t) this.game.hud.message(t); this.dirty = true; };
        const r1 = row();
        button(r1, "Host a room", 360, () => void this.menuActions?.host().then(say));
        button(r1, "Leave room", 330, () => this.menuActions?.leave());
        button(r1, "Save", 220, () => { this.menuActions?.save(); this.game.hud.message("Saved"); });
        button(r1, "Leave VR", 300, () => this.menuActions?.exitVR(), "#7a3a3a");
        this.codeText = new TextBlock("code", "");
        this.codeText.height = "90px";
        this.codeText.color = "#ffd166";
        this.codeText.fontSize = 46;
        pane.addControl(this.codeText);
        const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        for (let r = 0; r < 4; r++) {
            const kr = row(100);
            for (let c = 0; c < 8; c++) {
                const ch = ALPHA[r * 8 + c];
                button(kr, ch, 150, () => { if (this.code.length < 5) this.code += ch; }, "#ffffff22");
            }
        }
        const r3 = row();
        button(r3, "⌫ Delete", 300, () => { this.code = this.code.slice(0, -1); }, "#ffffff22");
        button(r3, "Join room", 360, () => { if (this.code.length === 5) void this.menuActions?.join(this.code).then(say); else say("Type the 5-letter room code"); });
        pane.isVisible = false;
    }

    /** the wrist display rides on the left controller, facing up at you */
    attach(src: WebXRInputSource) {
        const grip = src.grip ?? src.pointer;
        this.wrist.parent = grip;
        this.wrist.position.set(0, 0.06, 0.07);
        this.wrist.rotation.set(Math.PI / 2 - 0.6, 0, 0);
        this.wrist.setEnabled(true);
    }

    setVisible(v: boolean) {
        this.wrist.setEnabled(v && !!this.wrist.parent);
        if (!v) this.board.setEnabled(false);
    }

    get pointerBusy() { return this.board.isEnabled(); }

    open(tab: "bag" | "craft" | "menu") {
        const g = this.game;
        this.menuOpen = tab === "menu";
        if (tab === "menu") tab = "bag";
        if (g.stats.dead) return;
        if (!g.hud.inventoryOpen) g.setInventory(true, tab);
        else g.hud.setTab(tab);
        this.dirty = true;
    }
    toggle(tab: "bag" | "craft" | "menu") {
        if (this.game.hud.inventoryOpen) this.close();
        else this.open(tab);
    }
    close() { this.game.setInventory(false); }

    /** put the board in front of the head, at chest height */
    private placeBoard() {
        const cam = this.scene.activeCamera!;
        const f = cam.getDirection(Vector3.Forward(true));
        f.y = 0;
        f.normalize();
        this.board.position.copyFrom(cam.globalPosition.add(f.scale(0.85)).add(new Vector3(0, -0.25, 0)));
        // planes face +z in a right-handed scene: turn the front towards the viewer
        this.board.rotation.set(0.25, Math.atan2(-f.x, -f.z), 0);
    }

    update(_dt: number) {
        const g = this.game, hud = g.hud, s = g.stats;
        // wrist
        const vals = [s.health, s.hunger, s.thirst, s.stamina];
        vals.forEach((v, i) => { this.vit[i].fill.width = `${Math.max(0, Math.min(100, v))}%`; });
        for (let i = 0; i < this.hot.length; i++) {
            const it = g.inv.slots[i];
            this.fill(this.hot[i], it?.id, it?.count ?? 0);
            this.hot[i].root.color = i === hud.selected ? SEL : "#ffffff30";
            this.hot[i].root.thickness = i === hud.selected ? 8 : 3;
        }
        const p = hud.buildText ? `${hud.buildText}\n${hud.buildKeys}` : hud.promptName ? `${hud.promptName}${hud.promptHint ? "\n" + hud.promptHint : ""}` : "";
        if (this.prompt.text !== p) this.prompt.text = p;
        const now = performance.now();
        this.noteList = this.noteList.filter((n) => now - n.at < 6000);
        const nt = this.noteList.map((n) => n.t).join("\n");
        if (this.notes.text !== nt) this.notes.text = nt;
        if (s.dead && !this.notes.text) this.notes.text = `${s.deathCause}\nPull the trigger to respawn.`;

        // board
        const open = hud.inventoryOpen;
        if (open !== this.board.isEnabled()) {
            if (open) this.placeBoard();
            this.board.setEnabled(open);
            this.dirty = true;
        }
        if (!open || !this.dirty) return;
        this.dirty = false;
        const craft = hud.tab === "craft" && !this.menuOpen;
        this.bagPane.isVisible = !craft && !this.menuOpen;
        this.craftPane.isVisible = craft;
        this.menuPane.isVisible = this.menuOpen;
        this.tabBag.background = !craft && !this.menuOpen ? "#2d6a5a" : "#ffffff18";
        this.tabCraft.background = craft ? "#2d6a5a" : "#ffffff18";
        this.tabMenu.background = this.menuOpen ? "#2d6a5a" : "#ffffff18";
        if (this.menuOpen) { this.menuStatus.text = this.menuActions?.status() ?? ""; this.codeText.text = `Room code: ${this.code.padEnd(5, "_")}`; return; }
        if (craft) { this.renderCraft(); return; }
        const pick = hud.picked;
        for (let i = 0; i < this.grid.length; i++) {
            const it = g.inv.slots[i];
            this.fill(this.grid[i], it?.id, it?.count ?? 0);
            this.grid[i].root.background = pick && pick.c === 0 && pick.i === i ? "#ffd16655" : SLOT;
        }
        const c = hud.cont;
        this.contBox.isVisible = !!c;
        if (c) {
            this.contTitle.text = hud.contInfo?.title ?? "";
            for (let i = 0; i < this.cont.length; i++) {
                const vis = i < c.size;
                this.cont[i].root.isVisible = vis;
                if (!vis) continue;
                const it = c.slots[i];
                this.fill(this.cont[i], it?.id, it?.count ?? 0);
                this.cont[i].root.background = pick && pick.c === 1 && pick.i === i ? "#ffd16655" : SLOT;
            }
        }
        const ps = pick ? (pick.c === 0 ? g.inv : pick.c === 1 ? c : g.worn)?.slots[pick.i] : null;
        if (ps) {
            const d = ITEMS[ps.id];
            this.detail.text = `${d.name}${ps.count > 1 ? ` ×${ps.count}` : ""}\n\n${d.desc}`;
        } else this.detail.text = "Point at an item and pull the trigger to pick it, then at another slot to move it. The top row is your hotbar.";
        const own = !!pick && pick.c === 0 && !!ps;
        const def = ps ? ITEMS[ps.id] : null;
        this.actions[0].isVisible = own && (def?.kind === "food" || def?.kind === "armor");
        this.actions[1].isVisible = own && (ps?.count ?? 0) > 1;
        this.actions[2].isVisible = own;
        this.actions[3].isVisible = !!ps && !!c;
        const mv = this.actions[3].textBlock;
        if (mv) mv.text = pick?.c === 1 ? "Take" : `Move to ${hud.contInfo?.title ?? "box"}`;
    }

    private fill(s: ReturnType<typeof slotControl>, id: ItemId | undefined, count: number) {
        const url = id ? iconUrl(id) : "";
        if (s.img.source !== url) s.img.source = url || null;
        const t = count > 1 ? String(count) : "";
        if (s.cnt.text !== t) s.cnt.text = t;
    }

    private renderCraft() {
        const g = this.game, inv = g.inv, bench = g.hud.bench;
        const key = `${bench}|${inv.slots.map((s) => (s ? `${s.id}${s.count}` : "")).join(",")}`;
        if (key === this.craftKey) return;
        this.craftKey = key;
        this.craftList.clearControls();
        let group = "";
        for (const r of RECIPES) {
            if (r.group !== group) {
                group = r.group;
                const h = new TextBlock(`cg${group}`, GROUP_LABEL[r.group]);
                h.height = "80px";
                h.color = "#ffd166";
                h.fontSize = 40;
                h.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
                h.paddingLeft = "20px";
                this.craftList.addControl(h);
            }
            const def = ITEMS[r.out];
            const ok = canAfford(inv, r) && (!r.bench || bench);
            const row = new Grid(`cr${r.out}`);
            row.height = "120px";
            row.addColumnDefinition(120, true);
            row.addColumnDefinition(1);
            row.addColumnDefinition(260, true);
            const img = new Image(`ci${r.out}`, iconUrl(r.out));
            img.width = "96px";
            img.height = "96px";
            row.addControl(img, 0, 0);
            const costs = r.cost.map(([id, n]) => `${n} ${costLabel(r, id, ITEMS[id].name)} (${costHave(inv, r, id)})`).join(" · ");
            const tb = new TextBlock(`ct${r.out}`, `${def.name}${r.count > 1 ? ` ×${r.count}` : ""}\n${costs}${r.bench && !bench ? "\nNeeds a workbench nearby" : ""}`);
            tb.color = ok ? TXT : "#f4efe288";
            tb.fontSize = 32;
            tb.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            tb.textWrapping = true;
            row.addControl(tb, 0, 1);
            const btn = Button.CreateSimpleButton(`cb${r.out}`, "Craft");
            btn.height = "90px";
            btn.width = "220px";
            btn.color = TXT;
            btn.fontSize = 36;
            btn.cornerRadius = 20;
            btn.thickness = 0;
            btn.background = ok ? "#2d6a5a" : "#ffffff14";
            btn.isEnabled = ok;
            btn.onPointerUpObservable.add(() => { g.hud.onCraft?.(r); this.craftKey = ""; this.dirty = true; });
            row.addControl(btn, 0, 2);
            this.craftList.addControl(row);
        }
    }
}
