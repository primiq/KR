import { ImageProcessingConfiguration, Matrix, Mesh, MeshBuilder, Quaternion, type Scene, type StandardMaterial, Vector3, type WebXRInputSource } from "@babylonjs/core";
import type { GfxCustom, Quality } from "../core/quality";
import { AdvancedDynamicTexture, Button, Control, Grid, Image, Rectangle, ScrollViewer, StackPanel, TextBlock } from "@babylonjs/gui";
import type { Game } from "../game/game";
import { ITEMS, type ItemId } from "../game/items";
import { canAfford, costHave, costLabel, GROUP_LABEL, RECIPES } from "../game/recipes";
import { PHRASES } from "../net/chat";

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

/** the HUD's background: nearly solid (the bright sea and sky showing through made the text hard to pick out) */
const HUD_BG = "#08141bf2";
const SLOT = "#ffffff1f", SEL = "#ffd166", TXT = "#f4efe2";
/** the board's palette: a deep sea-green slate, warm parchment text, teal for what you can do, gold for what is picked */
const B_BG = "#0c1a21f2", B_EDGE = "#ffd16638", CARD = "#ffffff0d", CARD_EDGE = "#ffffff1c", ACC = "#3aa58a", ACC_DIM = "#ffffff12",
    INK = "#0c1a21", MUTED = "#f4efe28c", GOOD = "#8be0b5", SHORT = "#ff9a86";

/** a tab or toggle that lights up (teal, dark text) when it is the one showing */
function lit(b: Button, on: boolean) {
    b.background = on ? ACC : ACC_DIM;
    b.color = on ? INK : TXT;
}

/**
 * A panel shows its own colours: not tone-mapped, contrast-boosted or darkened by the comfort vignette like the world is
 * (in a headset the materials do those themselves; they turned the HUD's white text grey and dimmed the lower corner it
 * sits in).
 */
function plainColours(mesh: Mesh) {
    const m = mesh.material as StandardMaterial | null;
    if (!m) return;
    const ip = new ImageProcessingConfiguration();
    ip.isEnabled = false;
    m.imageProcessingConfiguration = ip;
    m.fogEnabled = false;
}

function slotControl(name: string, size: number): { root: Button; img: Image; cnt: TextBlock; key?: TextBlock } {
    const root = Button.CreateSimpleButton(name, "");
    root.width = `${size}px`;
    root.height = `${size}px`;
    root.cornerRadius = 20;
    root.thickness = 3;
    root.color = "#ffffff26";
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
 * Castaway's HUD and bag for the headset, in Babylon GUI: a heads-up display floating in the lower left of your view (vitals, hotbar, what you
 * are looking at, messages) and a floating bag / crafting panel you point at with the right hand's laser. Both read
 * the same Hud state as the flat-screen HTML overlay and call the same actions, so they always agree.
 */
export class VRPanel {
    private wrist: Mesh;
    private wristUI: AdvancedDynamicTexture;
    private board: Mesh;
    private boardUI: AdvancedDynamicTexture;
    /** the board's own controls (moved onto the screen overlay on a flat screen) */
    private boardRoot!: Rectangle;
    /** on a flat screen the board is a screen overlay: square on and the same size whichever way you look, and drawn after
     *  the picture's tone mapping, vignette and ambient occlusion (on the 3D plane they darkened it) */
    private flatUI: AdvancedDynamicTexture | null = null;
    private onFlatUI = false;
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
    private detailName: TextBlock;
    private actions: Button[] = [];
    private bagPane: Grid;
    private craftPane: ScrollViewer;
    private craftList: StackPanel;
    private tabBag: Button;
    private tabCraft: Button;
    private dirty = true;
    private tabMenu: Button;
    private menuOpen = false;
    /** the Graphics tab: the preset and your own mix, as chosen here (applied with a restart) */
    private gfxOpen = false;
    private gfx: { pref: string; custom: GfxCustom } | null = null;
    private gfxPane!: StackPanel;
    private gfxLabels: { b: Button; text: () => string; on?: () => boolean }[] = [];
    private devRows: Control[] = [];
    private tabGfx!: Button;
    /** the map and quick-chat tabs (null: bag / craft / menu) */
    private extra: "map" | "chat" | null = null;
    private tabMap!: Button;
    private tabChat!: Button;
    private mapPane!: Rectangle;
    private mapImg!: Image;
    private mapCanvas = document.createElement("canvas");
    private mapZoom = 1.6;
    private mapT = 0;
    private chatPane!: StackPanel;
    private chatPlayers!: TextBlock;
    private menuPane!: StackPanel;
    private menuStatus!: TextBlock;
    /** "Leave VR" in a headset, "Main menu" on a screen */
    private exitBtn: Button | null = null;
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
        /** the graphics settings: as saved, what a choice would come to, and apply (restarts) */
        gfx(): { pref: string; custom: GfxCustom };
        gfxPreview(pref: string, custom: GfxCustom): Quality;
        applyGfx(pref: string, custom: GfxCustom): void;
        /** multiplayer: quick chat, a ping on the map, who is here (null when solo) */
        chat?(text: string): void;
        pingAt?(x: number, z: number): void;
        players?(): string | null;
        /** Settings > Developer (the cheats: no keys for them) */
        dev?: { flying(): boolean; fly(): void; time(h: number): void; storm(): boolean };
    } | null = null;
    private craftKey = "";
    private jcWas = false;

    constructor(private readonly scene: Scene, private readonly game: Game) {
        // ---- wrist
        // (a little bigger than it was, and drawn at twice the resolution: the layout is in 1024 x 640 units, the texture twice that)
        this.wrist = MeshBuilder.CreatePlane("vrWrist", { width: 0.27, height: 0.16875 }, scene);
        this.wrist.isPickable = false;
        this.wrist.setEnabled(false);
        this.wrist.renderingGroupId = 1;
        this.wristUI = AdvancedDynamicTexture.CreateForMesh(this.wrist, 2048, 1280, false);
        plainColours(this.wrist);
        // (sharper text seen at an angle)
        this.wristUI.anisotropicFilteringLevel = 8;
        const w = new Rectangle("wbg");
        // (nearly solid: the bright sea and sky showing through made the text hard to pick out)
        w.background = HUD_BG;
        w.cornerRadius = 40;
        w.thickness = 0;
        // (laid out in 1024 x 640 units and drawn at twice the size: the text is rendered sharp at the texture's resolution)
        w.width = "1024px"; w.height = "640px";
        w.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT; w.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        w.transformCenterX = 0; w.transformCenterY = 0; w.scaleX = 2; w.scaleY = 2;
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
            label.fontSize = 30;
            label.fontWeight = "bold";
            label.outlineWidth = 5;
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
            s.root.background = "#ffffff2a";
            hot.addControl(s.root);
            this.hot.push(s);
        }
        col.addControl(hot);
        this.prompt = new TextBlock("prompt", "");
        this.prompt.height = "160px";
        this.prompt.color = TXT;
        this.prompt.fontSize = 44;
        this.prompt.fontWeight = "600";
        this.prompt.outlineWidth = 5;
        this.prompt.outlineColor = "#000a";
        this.prompt.textWrapping = true;
        this.prompt.paddingLeft = "30px";
        this.prompt.paddingRight = "30px";
        col.addControl(this.prompt);
        this.notes = new TextBlock("notes", "");
        this.notes.height = "200px";
        this.notes.color = "#ffe9a8";
        this.notes.fontSize = 38;
        this.notes.outlineWidth = 5;
        this.notes.outlineColor = "#000a";
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
        plainColours(this.board);
        this.boardUI.anisotropicFilteringLevel = 8;
        const b = (this.boardRoot = new Rectangle("bbg"));
        b.background = B_BG;
        b.cornerRadius = 44;
        b.thickness = 4;
        b.color = B_EDGE;
        this.boardUI.addControl(b);
        // (the tab strip: a darker band across the top, a gold hairline under it)
        const band = new Rectangle("bband");
        band.height = "116px";
        band.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        band.background = "#00000038";
        band.thickness = 0;
        b.addControl(band);
        const rule = new Rectangle("brule");
        rule.height = "3px";
        rule.top = "116px";
        rule.width = "96%";
        rule.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        rule.background = B_EDGE;
        rule.thickness = 0;
        b.addControl(rule);
        const top = new StackPanel("tabs");
        top.isVertical = false;
        top.height = "116px";
        top.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        top.paddingTop = "18px";
        top.paddingBottom = "14px";
        const tab = (name: string, label: string, fn: () => void, w = 214) => {
            const t = Button.CreateSimpleButton(name, label);
            t.width = `${w}px`;
            t.height = "84px";
            t.fontSize = 38;
            t.fontWeight = "bold";
            t.cornerRadius = 42;
            t.thickness = 0;
            t.paddingLeft = "7px";
            t.paddingRight = "7px";
            lit(t, false);
            t.onPointerUpObservable.add(fn);
            top.addControl(t);
            return t;
        };
        this.tabBag = tab("tbag", "Bag", () => { this.menuOpen = false; this.gfxOpen = false; this.extra = null; game.hud.setTab("bag"); this.dirty = true; });
        this.tabCraft = tab("tcraft", "Craft", () => { this.menuOpen = false; this.gfxOpen = false; this.extra = null; game.hud.setTab("craft"); this.dirty = true; });
        this.tabMap = tab("tmap", "Map", () => this.setExtra("map"));
        this.tabChat = tab("tchat", "Chat", () => this.setExtra("chat"));
        this.tabMenu = tab("tmenu", "Multiplayer", () => { this.menuOpen = true; this.gfxOpen = false; this.extra = null; this.dirty = true; }, 280);
        this.tabGfx = tab("tgfx", "Graphics", () => { this.gfxOpen = true; this.menuOpen = false; this.extra = null; this.gfx = this.menuActions?.gfx() ?? null; this.dirty = true; });
        const x = tab("tclose", "✕", () => this.close(), 110);
        x.background = "#b5483a";
        x.color = TXT;
        b.addControl(top);

        this.bagPane = new Grid("bag");
        this.bagPane.top = "130px";
        this.bagPane.height = "980px";
        this.bagPane.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        this.bagPane.addColumnDefinition(0.62);
        this.bagPane.addColumnDefinition(0.38);
        b.addControl(this.bagPane);
        const left = new StackPanel("left");
        left.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        left.paddingTop = "6px";
        this.bagPane.addControl(left, 0, 0);
        this.contBox = new StackPanel("cont");
        this.contTitle = new TextBlock("ctitle", "");
        this.contTitle.height = "60px";
        this.contTitle.color = SEL;
        this.contTitle.fontSize = 36;
        this.contTitle.fontWeight = "bold";
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
        const bagHead = new TextBlock("baghead", "Backpack");
        bagHead.height = "64px";
        bagHead.color = SEL;
        bagHead.fontSize = 36;
        bagHead.fontWeight = "bold";
        left.addControl(bagHead);
        const g = new Grid("slots");
        g.height = "672px";
        g.width = "1000px";
        for (let i = 0; i < 6; i++) g.addColumnDefinition(1 / 6);
        for (let r = 0; r < 4; r++) g.addRowDefinition(0.25);
        for (let i = 0; i < game.inv.size; i++) {
            const s = slotControl(`g${i}`, 154);
            if (i < game.inv.hotbar) {
                // (the hotbar: a gold rim and its number)
                s.root.color = "#ffd16680";
                const k = new TextBlock(`g${i}k`, String(i + 1));
                k.color = "#ffd166cc";
                k.fontSize = 28;
                k.fontWeight = "bold";
                k.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
                k.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
                k.paddingLeft = "12px";
                k.paddingTop = "6px";
                s.root.addControl(k);
            }
            s.root.onPointerUpObservable.add(() => { game.hud.slotClick(0, i); this.dirty = true; });
            g.addControl(s.root, Math.floor(i / 6), i % 6);
            this.grid.push(s);
        }
        left.addControl(g);
        // (the details card: what's picked, and what you can do with it)
        const card = new Rectangle("dcard");
        card.background = CARD;
        card.color = CARD_EDGE;
        card.thickness = 2;
        card.cornerRadius = 30;
        card.width = "560px";
        card.height = "920px";
        card.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        card.top = "10px";
        this.bagPane.addControl(card, 0, 1);
        const right = new StackPanel("right");
        right.width = "500px";
        right.paddingTop = "30px";
        right.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        card.addControl(right);
        this.detailName = new TextBlock("dname", "");
        this.detailName.height = "76px";
        this.detailName.color = SEL;
        this.detailName.fontSize = 44;
        this.detailName.fontWeight = "bold";
        this.detailName.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        right.addControl(this.detailName);
        this.detail = new TextBlock("detail", "Point at an item and pull the trigger.");
        this.detail.height = "430px";
        this.detail.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        this.detail.color = TXT;
        this.detail.fontSize = 34;
        this.detail.lineSpacing = "6px";
        this.detail.textWrapping = true;
        this.detail.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        right.addControl(this.detail);
        const act = (name: string, fn: () => void) => {
            const a = Button.CreateSimpleButton(name, name);
            a.height = "104px";
            a.color = INK;
            a.background = ACC;
            a.fontSize = 38;
            a.fontWeight = "bold";
            a.cornerRadius = 26;
            a.thickness = 0;
            a.paddingTop = "14px";
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
        this.craftPane.top = "128px";
        this.craftPane.height = "980px";
        this.craftPane.width = "1600px";
        this.craftPane.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        this.craftPane.thickness = 0;
        this.craftPane.barSize = 26;
        // (no outline round the bar's track)
        this.craftPane.color = "transparent";
        this.craftPane.barColor = "#ffd16699";
        this.craftPane.barBackground = "#ffffff10";
        this.craftList = new StackPanel("craftList");
        this.craftPane.addControl(this.craftList);
        // (a finger or the mouse can drag the list up and down, as on a phone)
        {
            let dragY: number | null = null;
            this.craftPane.onPointerDownObservable.add((v) => { dragY = v.y; });
            this.craftPane.onPointerMoveObservable.add((v) => {
                if (dragY === null) return;
                const bar = this.craftPane.verticalBar, dy = v.y - dragY; dragY = v.y;
                bar.value = Math.max(0, Math.min(1, bar.value - dy / 2200));
            });
            this.craftPane.onPointerUpObservable.add(() => { dragY = null; });
            this.craftPane.onPointerOutObservable.add(() => { dragY = null; });
        }
        b.addControl(this.craftPane);

        this.buildMenu(b);
        this.buildMap(b);
        this.buildChat(b);
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
        const button = (parent: StackPanel, label: string, w: number, fn: () => void, bg = ACC) => {
            const x = Button.CreateSimpleButton(`m${label}`, label);
            x.width = `${w}px`;
            x.height = "92px";
            x.color = bg === ACC ? INK : TXT;
            x.fontSize = 36;
            x.fontWeight = "bold";
            x.cornerRadius = 26;
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
        this.exitBtn = button(r1, "Leave VR", 300, () => this.menuActions?.exitVR(), "#7a3a3a");
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
                button(kr, ch, 150, () => { if (this.code.length < 5) this.code += ch; }, ACC_DIM);
            }
        }
        const r3 = row();
        button(r3, "⌫ Delete", 300, () => { this.code = this.code.slice(0, -1); }, ACC_DIM);
        button(r3, "Join room", 360, () => { if (this.code.length === 5) void this.menuActions?.join(this.code).then(say); else say("Type the 5-letter room code"); });
        pane.isVisible = false;
        this.buildGfx(b);
    }

    /** the Graphics tab */
    private buildGfx(parent: Rectangle) {
        const pane = new StackPanel("gfx");
        pane.top = "130px";
        pane.width = "1560px";
        pane.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        parent.addControl(pane);
        this.gfxPane = pane;
        const text = (t: string, h = 70, size = 36) => { const x = new TextBlock("gtext", t); x.height = `${h}px`; x.color = TXT; x.fontSize = size; x.textWrapping = true; pane.addControl(x); return x; };
        const row = () => { const r = new StackPanel("grow"); r.isVertical = false; r.height = "112px"; pane.addControl(r); return r; };
        const btn = (r: StackPanel, w: number, label: () => string, fn: () => void, on?: () => boolean) => {
            const x = Button.CreateSimpleButton("gb", "");
            x.width = `${w}px`; x.height = "92px"; x.color = TXT; x.fontSize = 36; x.fontWeight = "bold"; x.cornerRadius = 26; x.thickness = 0; x.background = ACC_DIM;
            x.paddingLeft = "8px"; x.paddingRight = "8px";
            x.onPointerUpObservable.add(() => { if (this.gfx) fn(); this.dirty = true; });
            r.addControl(x);
            this.gfxLabels.push({ b: x, text: label, on });
            return x;
        };
        const g = () => this.gfx!;
        const eff = () => this.menuActions!.gfxPreview(g().pref, g().custom);
        text("Graphics preset", 70, 40);
        const r0 = row();
        for (const [k, l] of [["auto", "Auto"], ["low", "Low"], ["medium", "Medium"], ["high", "High"]]) btn(r0, 340, () => l, () => { g().pref = k; g().custom = {}; }, () => g().pref === k);
        text("Your own mix (over the preset)", 70, 34);
        const onOff = (r: StackPanel, name: string, key: "shadows" | "reflect" | "bloom" | "ao") =>
            btn(r, 690, () => `${name}: ${eff()[key] ? "on" : "off"}`, () => { g().custom[key] = !eff()[key]; }, () => eff()[key]);
        const r1 = row(); onOff(r1, "Shadows", "shadows"); onOff(r1, "Sea reflections", "reflect");
        const r2 = row(); onOff(r2, "Bloom glow", "bloom"); onOff(r2, "Ambient occlusion", "ao");
        const r3 = row();
        const RES = [1, 0.85, 0.7], GRASS = ["low", "medium", "high"] as const, GN = { low: "short range", medium: "medium", high: "far and thick" };
        btn(r3, 690, () => `Resolution: ${Math.round((1 / eff().scale) * 100)}%`, () => { const cur = Math.round((1 / eff().scale) * 100) / 100; g().custom.res = RES[(RES.findIndex((v) => Math.abs(v - cur) < 0.02) + 1) % RES.length]; });
        btn(r3, 690, () => `Grass: ${GN[eff().grassTier]}`, () => { g().custom.grass = GRASS[(GRASS.indexOf(eff().grassTier) + 1) % 3]; });
        const r4 = row();
        btn(r4, 500, () => "Back to the preset", () => { g().custom = {}; });
        const ap = btn(r4, 600, () => "Apply", () => this.menuActions?.applyGfx(g().pref, g().custom));
        ap.background = SEL;
        ap.color = INK;
        text("Most changes apply straight away. A new preset or grass range rebuilds the island (saved first): you come straight back to it.", 110, 30);
        const devT = text("Developer", 70, 34);
        const r5 = row();
        // (only in developer mode: main gives no dev actions otherwise)
        this.devRows = [devT, r5];
        btn(r5, 400, () => `Flying: ${this.menuActions?.dev?.flying() ? "on" : "off"}`, () => this.menuActions?.dev?.fly(), () => !!this.menuActions?.dev?.flying());
        btn(r5, 340, () => "Time -1 h", () => this.menuActions?.dev?.time(-1));
        btn(r5, 340, () => "Time +1 h", () => this.menuActions?.dev?.time(1));
        btn(r5, 420, () => "Sandstorm", () => { this.menuActions?.dev?.storm(); });
        pane.isVisible = false;
    }

    private setExtra(t: "map" | "chat" | null) {
        this.extra = t; this.menuOpen = false; this.mapT = 0; this.dirty = true;
        this.game.map.boost = t === "map";
    }

    /** the map: Castaway's map drawn into a canvas of its own; point at it and pull the trigger to ping a spot */
    private buildMap(b: Rectangle) {
        const S = 900;
        this.mapCanvas.width = this.mapCanvas.height = S;
        const pane = new Rectangle("mapPane");
        pane.thickness = 0;
        pane.top = "120px";
        pane.height = "980px";
        pane.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        b.addControl(pane);
        this.mapPane = pane;
        const img = new Image("mapImg");
        img.domImage = this.mapCanvas as unknown as HTMLImageElement;
        img.width = `${S}px`; img.height = `${S}px`;
        img.left = "40px";
        img.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        img.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        img.isPointerBlocker = true;
        img.onPointerUpObservable.add((e) => {
            const l = img.getLocalCoordinates(e);
            const w = this.game.map.toWorld(l.x / img.widthInPixels, l.y / img.heightInPixels);
            if (this.menuActions?.pingAt) this.menuActions.pingAt(w.x, w.z);
        });
        pane.addControl(img);
        this.mapImg = img;
        const side = new StackPanel("mapSide");
        side.width = "620px";
        side.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
        side.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        side.paddingRight = "30px";
        pane.addControl(side);
        const zrow = new StackPanel("zrow");
        zrow.isVertical = false; zrow.height = "110px";
        side.addControl(zrow);
        const zb = (label: string, f: number) => {
            const x = Button.CreateSimpleButton(`z${label}`, label);
            x.width = "280px"; x.height = "92px"; x.color = INK; x.fontSize = 38; x.fontWeight = "bold"; x.cornerRadius = 26; x.thickness = 0; x.background = ACC;
            x.paddingLeft = "8px"; x.paddingRight = "8px";
            x.onPointerUpObservable.add(() => { this.mapZoom = Math.max(1, Math.min(6, this.mapZoom * f)); this.mapT = 0; });
            zrow.addControl(x);
        };
        zb("Zoom +", 1.5); zb("Zoom −", 1 / 1.5);
        const help = new TextBlock("mapHelp", "You are the white arrow. North is up.\n\nIn a room with friends, point at the map (or click it) to ping that spot for everyone.");
        help.height = "420px"; help.color = TXT; help.fontSize = 34; help.textWrapping = true;
        help.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        side.addControl(help);
        pane.isVisible = false;
    }

    /** quick chat (the same phrases as the flat screen: no free text, no keyboard) and who is in the room */
    private buildChat(b: Rectangle) {
        const pane = new StackPanel("chatPane");
        pane.top = "130px";
        pane.width = "1560px";
        pane.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        b.addControl(pane);
        this.chatPane = pane;
        for (let r = 0; r < Math.ceil(PHRASES.length / 4); r++) {
            const row = new StackPanel(`chr${r}`);
            row.isVertical = false; row.height = "120px";
            pane.addControl(row);
            for (const ph of PHRASES.slice(r * 4, r * 4 + 4)) {
                const x = Button.CreateSimpleButton(`ch${ph}`, ph);
                x.width = "380px"; x.height = "100px"; x.color = INK; x.fontSize = 38; x.fontWeight = "bold"; x.cornerRadius = 26; x.thickness = 0; x.background = ACC;
                x.paddingLeft = "8px"; x.paddingRight = "8px";
                x.onPointerUpObservable.add(() => { if (this.menuActions?.chat) { this.menuActions.chat(ph); this.close(); } });
                row.addControl(x);
            }
        }
        this.chatPlayers = new TextBlock("chatPlayers", "");
        this.chatPlayers.height = "640px"; this.chatPlayers.color = TXT; this.chatPlayers.fontSize = 36;
        this.chatPlayers.textWrapping = true; this.chatPlayers.paddingTop = "30px";
        this.chatPlayers.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        pane.addControl(this.chatPlayers);
        pane.isVisible = false;
    }

    /**
     * The HUD (vitals and the hotbar) floats in the lower left of your view, about 75 cm away, and follows your head lazily
     * (it trails a turn a little instead of being glued to your eyes, which is easier to look at and to read).
     */
    attach(_src: WebXRInputSource) {
        this.hudOn = true;
        this.wrist.setEnabled(true);
    }
    private hudOn = false;
    /** (nearer the middle of the view than it was, where the lenses are sharp, and turned to face your eye) */
    private static readonly HUD_AT = new Vector3(-0.13, -0.16, -0.58);
    private followHead(_dt: number) {
        const cam = this.scene.activeCamera;
        if (!cam || !this.hudOn) return;
        // fixed in the lower left of your view: placed from the head as the headset draws it this frame (its eyes), so it
        // never slides about as you walk or turn
        const rigs = cam.rigCameras;
        let at: Vector3, q: Quaternion;
        const rq = rigs.length ? (rigs[0] as unknown as { rotationQuaternion: Quaternion | null }).rotationQuaternion : null;
        if (rq) {
            const c = new Vector3();
            for (const r of rigs) c.addInPlace(r.position);
            c.scaleInPlace(1 / rigs.length);
            q = rq;
            at = c.add(VRPanel.HUD_AT.applyRotationQuaternion(q));
        } else {
            q = cam.absoluteRotation;
            at = cam.globalPosition.add(VRPanel.HUD_AT.applyRotationQuaternion(q));
        }
        const w = this.wrist;
        // turned to face the eye square on (not lying in the plane of the view, foreshortened out at the side)
        const eye = at.subtract(VRPanel.HUD_AT.applyRotationQuaternion(q));
        const toEye = eye.subtract(at).normalize(), upV = Vector3.Up().applyRotationQuaternion(q);
        // (planes face +z: its +z axis points back at the eye)
        const zA = toEye, xA = Vector3.Cross(upV, zA).normalize(), yA = Vector3.Cross(zA, xA);
        const face = Quaternion.FromRotationMatrix(Matrix.FromValues(xA.x, xA.y, xA.z, 0, yA.x, yA.y, yA.z, 0, zA.x, zA.y, zA.z, 0, 0, 0, 0, 1));
        if (!w.rotationQuaternion) w.rotationQuaternion = face; else w.rotationQuaternion.copyFrom(face);
        w.position.copyFrom(at);
    }

    setVisible(v: boolean) {
        this.hudOn = v && this.hudOn;
        this.wrist.setEnabled(v && this.hudOn);
        if (!v) this.board.setEnabled(false);
    }

    get pointerBusy() { return this.board.isEnabled(); }

    open(tab: "bag" | "craft" | "menu" | "map" | "chat") {
        const g = this.game;
        this.menuOpen = tab === "menu";
        this.gfxOpen = false;
        this.setExtra(tab === "map" || tab === "chat" ? tab : null);
        this.menuOpen = tab === "menu";
        if (tab === "menu" || tab === "map" || tab === "chat") tab = "bag";
        if (g.stats.dead) return;
        if (!g.hud.inventoryOpen) g.setInventory(true, tab);
        else g.hud.setTab(tab);
        this.dirty = true;
    }
    toggle(tab: "bag" | "craft" | "menu" | "map" | "chat") {
        if (this.game.hud.inventoryOpen) this.close();
        else this.open(tab);
    }
    close() { this.game.setInventory(false); }

    /** the right stick scrolls the crafting list while the board is up (`dy` -1 up .. 1 down) */
    scroll(dy: number, dt: number) {
        if (!this.craftPane.isVisible) return;
        const bar = this.craftPane.verticalBar;
        bar.value = Math.max(0, Math.min(1, bar.value + dy * dt * 0.9));
    }

    /** where the head is drawn this frame (the headset's eyes) */
    private drawnHead(): Vector3 {
        const cam = this.scene.activeCamera!, rigs = cam.rigCameras;
        if (!rigs.length) return cam.globalPosition.clone();
        const c = new Vector3();
        for (const r of rigs) c.addInPlace(r.position);
        return c.scaleInPlace(1 / rigs.length);
    }
    /** the board's place relative to your head: it travels with you (walking, on a boat) without turning as you look about */
    private boardOff = new Vector3();
    /** put the board in front of the head, at chest height */
    /**
     * On a flat screen (desktop, phone, tablet) the board is the game's menu too: right in front of the camera, square on,
     * filling most of the view, and close (nearer than your own hands, so the mouse or a finger always reaches it).
     */
    flat = false;
    /** the board's controls go onto the screen overlay (flat screen) or back onto the plane (headset) */
    private hostFlat(on: boolean) {
        if (on === this.onFlatUI) return;
        this.onFlatUI = on;
        const b = this.boardRoot;
        if (on) {
            if (!this.flatUI) {
                this.flatUI = AdvancedDynamicTexture.CreateFullscreenUI("boardFlat", true, this.scene);
                // (scaled to fit: the whole board on screen, a little margin round it, whatever the window's shape)
                this.flatUI.idealWidth = 1650 / 0.94;
                this.flatUI.idealHeight = 1125 / 0.92;
                this.flatUI.useSmallestIdeal = true;
            }
            this.boardUI.removeControl(b);
            b.width = "1650px"; b.height = "1125px";
            this.flatUI.addControl(b);
        } else {
            this.flatUI?.removeControl(b);
            b.width = "100%"; b.height = "100%";
            this.boardUI.addControl(b);
        }
    }
    private placeFlat() {
        const cam = this.scene.activeCamera!;
        const f = cam.getDirection(Vector3.Forward(true)).normalize();
        const k = 0.3, fov = (cam as { fov?: number }).fov ?? 0.8, aspect = this.scene.getEngine().getAspectRatio(cam);
        const t = Math.tan(fov / 2), d = Math.max((0.375 * k) / (t * 0.92), (0.55 * k) / (t * aspect * 0.94));
        this.board.scaling.setAll(k);
        this.board.position.copyFrom(cam.globalPosition.add(f.scale(d)));
        this.board.rotation.set(-Math.asin(Math.max(-1, Math.min(1, f.y))), Math.atan2(-f.x, -f.z), 0);
    }
    private placeBoard() {
        if (this.flat) { this.placeFlat(); return; }
        this.board.scaling.setAll(1);
        const cam = this.scene.activeCamera!;
        const f = cam.getDirection(Vector3.Forward(true));
        f.y = 0;
        f.normalize();
        this.board.position.copyFrom(cam.globalPosition.add(f.scale(0.85)).add(new Vector3(0, -0.25, 0)));
        // planes face +z in a right-handed scene: turn the front towards the viewer
        this.board.rotation.set(0.25, Math.atan2(-f.x, -f.z), 0);
        this.boardOff.copyFrom(this.board.position.subtract(this.drawnHead()));
    }

    update(_dt: number) {
        this.followHead(_dt);
        const g = this.game, hud = g.hud, s = g.stats;
        // wrist
        const vals = [s.health, s.hunger, s.thirst, s.stamina];
        vals.forEach((v, i) => { this.vit[i].fill.width = `${Math.max(0, Math.min(100, v))}%`; });
        for (let i = 0; i < this.hot.length; i++) {
            const it = g.inv.slots[i];
            this.fill(this.hot[i], it?.id, it?.count ?? 0);
            this.hot[i].root.color = i === hud.selected ? SEL : "#ffffff55";
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
        this.hostFlat(this.flat);
        // (flat: the plane stays hidden, the overlay shows the board)
        this.board.isVisible = !this.flat;
        this.boardRoot.isVisible = !this.flat || open;
        if (this.flatUI) this.flatUI.layer!.isEnabled = this.flat && open;
        if (open !== this.board.isEnabled()) {
            if (open) this.placeBoard();
            // (shut: next time it opens on the bag, unless it is opened on another tab on purpose)
            else { this.menuOpen = false; this.gfxOpen = false; this.extra = null; }
            this.board.setEnabled(open);
            this.dirty = true;
        } else if (open && this.flat) this.placeFlat();
        else if (open) this.board.position.copyFrom(this.drawnHead().add(this.boardOff));
        if (open && this.extra === "map") {
            // the map redraws a few times a second while it shows (you, friends, pings move)
            this.mapT -= _dt;
            if (this.mapT <= 0) {
                this.mapT = 0.25;
                g.map.setView(g.player.pos.x, g.player.pos.z, this.mapZoom);
                g.map.render(this.mapCanvas.getContext("2d")!, this.mapCanvas.width);
                this.mapImg.markAsDirty();
            }
        }
        if (open && this.extra === "chat") {
            const who = this.menuActions?.players?.() ?? null;
            const t = who ?? "Playing solo: host a room from the Multiplayer tab (or join a friend's) to chat.";
            if (this.chatPlayers.text !== t) this.chatPlayers.text = t;
        }
        // (a craft's highlight coming on and going off redraws the board)
        const jcNow = !!hud.justCrafted && performance.now() < hud.justCrafted.until;
        if (jcNow !== this.jcWas) { this.jcWas = jcNow; this.dirty = true; }
        if (!open || !this.dirty) return;
        this.dirty = false;
        const ex = this.extra, other = this.menuOpen || this.gfxOpen || !!ex;
        const craft = hud.tab === "craft" && !other;
        this.bagPane.isVisible = !craft && !other;
        this.craftPane.isVisible = craft;
        this.menuPane.isVisible = this.menuOpen;
        this.gfxPane.isVisible = this.gfxOpen;
        lit(this.tabGfx, this.gfxOpen);
        this.mapPane.isVisible = ex === "map";
        this.chatPane.isVisible = ex === "chat";
        lit(this.tabBag, !craft && !other);
        lit(this.tabCraft, craft);
        lit(this.tabMenu, this.menuOpen);
        lit(this.tabMap, ex === "map");
        lit(this.tabChat, ex === "chat");
        if (ex) return;
        if (this.gfxOpen && this.gfx) {
            for (const l of this.gfxLabels) { if (l.b.textBlock) l.b.textBlock.text = l.text(); if (l.on) lit(l.b, l.on()); }
            for (const c of this.devRows) c.isVisible = !!this.menuActions?.dev;
            return;
        }
        if (this.exitBtn?.textBlock) this.exitBtn.textBlock.text = this.flat ? "Main menu" : "Leave VR";
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
            this.detailName.text = `${d.name}${ps.count > 1 ? `  ×${ps.count}` : ""}`;
            this.detail.text = d.desc;
        } else {
            this.detailName.text = "Your bag";
            this.detail.text = this.flat
                ? "Click (or tap) an item to pick it, then another slot to move it there. The top row (gold) is your hotbar."
                : "Point at an item and pull the trigger to pick it, then at another slot to move it. The top row (gold) is your hotbar.";
        }
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
        const jc = g.hud.justCrafted && performance.now() < g.hud.justCrafted.until ? g.hud.justCrafted.id : "";
        const key = `${bench}|${jc}|${inv.slots.map((s) => (s ? `${s.id}${s.count}` : "")).join(",")}`;
        if (key === this.craftKey) return;
        this.craftKey = key;
        this.craftList.clearControls();
        // two cards a row, under a heading per group
        const W = 1560, CW = 762, CH = 176;
        let group = "", row: StackPanel | null = null, n = 0;
        for (const r of RECIPES) {
            if (r.group !== group) {
                group = r.group;
                const h = new Rectangle(`cg${group}`);
                h.width = `${W}px`;
                h.height = "84px";
                h.thickness = 0;
                const ht = new TextBlock(`cgt${group}`, GROUP_LABEL[r.group].toUpperCase());
                ht.color = SEL;
                ht.fontSize = 34;
                ht.fontWeight = "bold";
                ht.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
                ht.paddingLeft = "16px";
                ht.paddingTop = "14px";
                h.addControl(ht);
                const hl = new Rectangle(`cgl${group}`);
                hl.height = "2px";
                hl.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
                hl.top = "-10px";
                hl.background = B_EDGE;
                hl.thickness = 0;
                h.addControl(hl);
                this.craftList.addControl(h);
                row = null;
                n = 0;
            }
            if (!row || n === 2) {
                row = new StackPanel(`crr${r.out}`);
                row.isVertical = false;
                row.width = `${W}px`;
                row.height = `${CH + 16}px`;
                this.craftList.addControl(row);
                n = 0;
            }
            n++;
            const def = ITEMS[r.out];
            const ok = canAfford(inv, r) && (!r.bench || bench);
            // (just crafted: the card glows gold for a moment)
            const fresh = jc === r.out;
            const slot = new Rectangle(`cs${r.out}`);
            slot.width = `${W / 2}px`;
            slot.height = `${CH + 16}px`;
            slot.thickness = 0;
            row.addControl(slot);
            const card = new Rectangle(`cc${r.out}`);
            card.width = `${CW}px`;
            card.height = `${CH}px`;
            card.cornerRadius = 28;
            card.thickness = fresh ? 4 : 2;
            card.color = fresh ? SEL : ok ? "#3aa58a88" : CARD_EDGE;
            card.background = fresh ? "#ffd16626" : ok ? "#3aa58a14" : CARD;
            slot.addControl(card);
            const grid = new Grid(`cgr${r.out}`);
            grid.addColumnDefinition(140, true);
            grid.addColumnDefinition(1);
            grid.addColumnDefinition(172, true);
            card.addControl(grid);
            // the item, on a round plate
            const plate = new Rectangle(`cp${r.out}`);
            plate.width = "122px";
            plate.height = "122px";
            plate.cornerRadius = 61;
            plate.thickness = 0;
            plate.background = ok ? "#ffffff1a" : "#ffffff0c";
            grid.addControl(plate, 0, 0);
            const img = new Image(`ci${r.out}`, iconUrl(r.out));
            img.width = "96px";
            img.height = "96px";
            img.alpha = ok ? 1 : 0.55;
            plate.addControl(img);
            // its name, then what it costs: a chip per ingredient, green when you have enough
            const mid = new StackPanel(`cm${r.out}`);
            mid.paddingTop = "14px";
            grid.addControl(mid, 0, 1);
            const name = new TextBlock(`cn${r.out}`, `${def.name}${r.count > 1 ? `  ×${r.count}` : ""}`);
            name.height = "56px";
            name.color = ok ? TXT : MUTED;
            name.fontSize = 36;
            name.fontWeight = "bold";
            name.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            mid.addControl(name);
            const chips = new StackPanel(`cch${r.out}`);
            chips.isVertical = false;
            chips.height = "62px";
            chips.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            mid.addControl(chips);
            for (const [id, need] of r.cost) {
                const have = costHave(inv, r, id), enough = have >= need;
                const chip = new Rectangle(`ck${r.out}${id}`);
                chip.width = "150px";
                chip.height = "54px";
                chip.cornerRadius = 27;
                chip.thickness = 0;
                chip.background = enough ? "#3aa58a2e" : "#ff9a8624";
                chip.paddingRight = "8px";
                const ci = new Image(`cki${r.out}${id}`, iconUrl(id));
                ci.width = "38px";
                ci.height = "38px";
                ci.left = "9px";
                ci.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
                chip.addControl(ci);
                const ct = new TextBlock(`ckt${r.out}${id}`, `${Math.min(have, 999)}/${need}`);
                ct.color = enough ? GOOD : SHORT;
                ct.fontSize = 26;
                ct.fontWeight = "bold";
                ct.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
                ct.paddingRight = "12px";
                chip.addControl(ct);
                chips.addControl(chip);
            }
            const note = new TextBlock(`cno${r.out}`, r.bench && !bench ? "⚒ Needs a workbench nearby" : r.cost.map(([id]) => costLabel(r, id, ITEMS[id].name)).join(" · "));
            note.height = "40px";
            note.color = r.bench && !bench ? "#ffb870" : MUTED;
            note.fontSize = 24;
            note.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            note.textWrapping = false;
            mid.addControl(note);
            const btn = Button.CreateSimpleButton(`cb${r.out}`, fresh ? "✓ Done!" : "Craft");
            btn.height = "112px";
            btn.width = "156px";
            btn.color = ok || fresh ? INK : MUTED;
            btn.fontSize = 36;
            btn.fontWeight = "bold";
            btn.cornerRadius = 30;
            btn.thickness = 0;
            btn.background = fresh ? SEL : ok ? ACC : "#ffffff10";
            btn.isEnabled = ok;
            btn.disabledColor = "#ffffff10";
            btn.disabledColorItem = MUTED;
            btn.onPointerUpObservable.add(() => { g.hud.onCraft?.(r); this.craftKey = ""; this.dirty = true; });
            grid.addControl(btn, 0, 2);
        }
    }
}
