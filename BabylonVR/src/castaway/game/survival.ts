import { clamp } from '../core/noise';

export type HurtCause = 'starvation' | 'thirst' | 'drowning' | 'fall' | 'attack' | 'poison';

export interface Tick {
  dt: number;
  moving: boolean;
  sprinting: boolean;
  swimming: boolean;
  jumped: boolean;
  /** head under water */
  underwater?: boolean;
}

/** Health, hunger, thirst and stamina. All values 0..100. Tuned so a full bar of food lasts ~35 minutes. */
export class Stats {
  health = 100;
  hunger = 100;
  thirst = 100;
  stamina = 100;
  /** breath: a minute under water from full */
  oxygen = 100;
  dead = false;
  deathCause = '';
  /** false while winded; stays false until stamina recovers a bit so sprint doesn't flicker */
  canSprint = true;
  onHurt: ((amount: number, cause: HurtCause) => void) | null = null;
  private regenDelay = 0;
  godMode = false;

  reset() {
    this.health = this.hunger = this.thirst = this.stamina = this.oxygen = 100;
    this.dead = false; this.deathCause = ''; this.canSprint = true; this.regenDelay = 0;
  }

  eat(hunger: number, thirst: number, health = 0) {
    this.hunger = clamp(this.hunger + hunger, 0, 100);
    this.thirst = clamp(this.thirst + thirst, 0, 100);
    this.health = clamp(this.health + health, 0, 100);
  }

  drink(amount: number) { this.thirst = clamp(this.thirst + amount, 0, 100); }

  hurt(amount: number, cause: HurtCause) {
    if (this.dead || this.godMode) return;
    this.health = Math.max(0, this.health - amount);
    this.onHurt?.(amount, cause);
    if (this.health <= 0) {
      this.dead = true;
      this.deathCause = {
        starvation: 'You starved.', thirst: 'You died of thirst.', drowning: 'You drowned.', fall: 'You fell too far.',
        attack: 'You were killed by a wild animal.', poison: 'Bad meat did you in.',
      }[cause];
    }
  }

  update(t: Tick) {
    if (this.dead) return;
    const { dt } = t;

    // hunger and thirst
    this.hunger = Math.max(0, this.hunger - (0.045 + (t.sprinting ? 0.03 : 0)) * dt);
    this.thirst = Math.max(0, this.thirst - (0.065 + (t.sprinting ? 0.045 : 0)) * dt);

    // stamina
    // everything that costs stamina costs 80% less than it used to (rc.59): a full bar sprints for ~40 s instead of ~8,
    // swims for minutes, and a jump costs barely anything
    const K = 0.2 / 1.3;
    let drain = 0;
    if (t.sprinting) drain = (t.swimming ? 9 : 16) * K;
    else if (t.swimming && t.moving) drain = 3 * K;
    if (t.jumped) this.stamina = Math.max(0, this.stamina - 8 * K);
    if (drain > 0) {
      this.stamina = Math.max(0, this.stamina - drain * dt);
      this.regenDelay = 0.5;
    } else {
      this.regenDelay = Math.max(0, this.regenDelay - dt);
      if (this.regenDelay <= 0) this.stamina = Math.min(100, this.stamina + (t.swimming ? 8 : 18) * dt);
    }
    if (this.stamina <= 0) this.canSprint = false;
    else if (this.stamina >= 25) this.canSprint = true;

    // damage / recovery
    if (this.hunger <= 0) this.hurt(0.8 * dt, 'starvation');
    if (this.thirst <= 0) this.hurt(1.2 * dt, 'thirst');
    // breath: 60 s under water; then you drown (about ten more seconds from full health). Back at the air it comes back quickly.
    if (t.underwater) { this.oxygen = Math.max(0, this.oxygen - (100 / 60) * dt); if (this.oxygen <= 0) this.hurt(10 * dt, 'drowning'); }
    else this.oxygen = Math.min(100, this.oxygen + 30 * dt);
    if (this.hunger > 30 && this.thirst > 30 && this.health < 100 && !this.dead) {
      this.health = Math.min(100, this.health + 0.35 * dt);
    }
  }
}
