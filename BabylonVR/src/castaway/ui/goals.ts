// First steps: a small card on the HUD for a new player, one goal at a time ("Gather wood, stone and fibre", "Craft a
// hatchet", ...). Each goal ticks itself off when the game sees it done (what is in your bag, what stands on the island)
// and the next one appears; after the last, or when closed with its x, it is gone for good (remembered in prefs). It
// never blocks anything and is not shown in a headset (the HUD is not drawn there).
import { getPref, setPref } from '../core/prefs';

export interface GoalWorld {
  count(id: string): number;
  /** is a structure of one of these kinds standing anywhere? */
  built(...kinds: string[]): boolean;
  /** does a raft or a boat exist (or is one in the bag)? */
  afloat(): boolean;
  touch: boolean;
}

interface Goal { title: string; text: (w: GoalWorld) => string; done: (w: GoalWorld) => boolean }

const GOALS: Goal[] = [
  {
    title: 'Gather', text: (w) => `Hit palm trees, rocks and bushes with your stone (${w.touch ? 'HIT' : 'click'}) and pick up what falls: you need wood, stone and fibre.`,
    done: (w) => (w.count('wood') >= 15 && w.count('stone') >= 10 && w.count('fiber') >= 5) || w.count('hatchet') + w.count('metal_hatchet') > 0,
  },
  {
    title: 'Craft a hatchet', text: (w) => `Open your bag (${w.touch ? 'the BAG button' : 'Tab'}), go to Craft and make a hatchet. Trees fall much faster with it.`,
    done: (w) => w.count('hatchet') + w.count('metal_hatchet') > 0,
  },
  {
    title: 'Light a campfire', text: () => 'Craft a campfire (15 wood, 5 stone), hold it and set it down. It keeps the night creatures away and cooks your food.',
    done: (w) => w.built('campfire'),
  },
  {
    title: 'Build a workbench', text: () => 'Craft a workbench (40 wood, 20 stone, 10 fibre) and set it down: it unlocks everything else, from a bed to a raft.',
    done: (w) => w.built('workbench'),
  },
  {
    title: 'A place to sleep', text: () => 'Craft a sleeping bag or a bed and set it down. Sleeping skips the night, and you wake up there if things go wrong.',
    done: (w) => w.built('bed', 'sleeping_bag'),
  },
  {
    title: 'Out to sea', text: () => 'Build a raft or a boat at the workbench and launch it. There is a lot out there: islets, wrecks, and far to the north, the ice.',
    done: (w) => w.afloat(),
  },
];
const KEY = 'castaway.goals';

export class Goals {
  private el: HTMLDivElement;
  private i: number;
  private t = 0;
  onDone: (title: string, last: boolean) => void = () => {};

  constructor(private readonly w: GoalWorld) {
    this.i = Math.max(0, Math.min(GOALS.length, Number(getPref(KEY)) || 0));
    this.el = document.createElement('div');
    this.el.id = 'goals';
    this.el.innerHTML = '<button type="button" aria-label="Hide the first steps">×</button><b></b><span></span><i></i>';
    this.el.querySelector('button')!.addEventListener('click', () => { this.i = GOALS.length; setPref(KEY, String(this.i)); this.draw(); });
    document.getElementById('hud')?.appendChild(this.el);
    this.draw();
  }

  /** call every frame: checks about once a second */
  update(dt: number) {
    if (this.i >= GOALS.length) return;
    if ((this.t -= dt) > 0) return;
    this.t = 1;
    let moved = false;
    while (this.i < GOALS.length && GOALS[this.i].done(this.w)) {
      const g = GOALS[this.i++];
      moved = true;
      // (only the step just finished is announced: somebody with a whole camp already skips through silently)
      if (this.i >= GOALS.length || !GOALS[this.i].done(this.w)) this.onDone(g.title, this.i >= GOALS.length);
    }
    if (moved) { setPref(KEY, String(this.i)); this.draw(); }
  }

  private draw() {
    const g = GOALS[this.i];
    this.el.classList.toggle('hidden', !g);
    if (!g) return;
    this.el.querySelector('b')!.textContent = g.title;
    this.el.querySelector('span')!.textContent = g.text(this.w);
    this.el.querySelector('i')!.textContent = `First steps ${this.i + 1} / ${GOALS.length}`;
  }
}
