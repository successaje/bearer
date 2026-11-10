/**
 * What a vault is for, shown as the art on its card. The locked contract stores only a name and a
 * finish, so the category is read from the name: a leading emoji picks it (the create form puts
 * one there), and failing that a few plain words do ("College fund" is savings). No match: the
 * classic card.
 */
export type CategoryId = "gift" | "birthday" | "prize" | "savings" | "capsule" | "letter" | "pizza" | "moon" | "treasure";

export interface Category {
  id: CategoryId;
  /** One code point, so it costs 3 or 4 of the name's 32 bytes. */
  emoji: string;
  label: string;
  blurb: string;
  fun?: boolean;
  /** Whole words that pick it when the name has no emoji. */
  words: RegExp;
}

export const CATEGORIES: Category[] = [
  { id: "gift", emoji: "🎁", label: "Gift", blurb: "For someone to open when they like", words: /\b(gift|present)s?\b/i },
  { id: "birthday", emoji: "🎂", label: "Birthday", blurb: "A birthday, a graduation, a big day", words: /\b(birthday|bday|graduation)s?\b/i },
  { id: "prize", emoji: "🏆", label: "Prize", blurb: "For a winner, who can check it first", words: /\b(prize|reward|bounty|winner|trophy)s?\b/i },
  { id: "savings", emoji: "🐷", label: "Savings", blurb: "A college fund, a nest egg", words: /\b(savings?|fund|college|nest egg|piggy)\b/i },
  { id: "capsule", emoji: "⏳", label: "Time capsule", blurb: "Sealed for later, maybe on a date", words: /\b(capsule|someday|future|later)\b/i },
  { id: "letter", emoji: "💌", label: "Love letter", blurb: "Sent as a link, in a message", words: /\b(letter|love|links?)\b/i },
  { id: "pizza", emoji: "🍕", label: "Pizza money", blurb: "10,000 BTC once bought two pizzas", fun: true, words: /\bpizzas?\b/i },
  { id: "moon", emoji: "🚀", label: "To the moon", blurb: "For the patient", fun: true, words: /\b(moon|rocket|hodl)\b/i },
  { id: "treasure", emoji: "💰", label: "Treasure", blurb: "Buried, until someone opens it", fun: true, words: /\b(treasure|treasury|chest|stash|loot)\b/i },
];

const BY_EMOJI = new Map(CATEGORIES.map((c) => [c.emoji, c]));

/** The category a name picks, and the name to show without its emoji. */
export function readName(name: string | null | undefined): { category: Category | null; title: string } {
  const text = (name ?? "").trim();
  const first = Array.from(text)[0] ?? "";
  const byEmoji = BY_EMOJI.get(first);
  if (byEmoji) return { category: byEmoji, title: text.slice(first.length).trim() };
  return { category: CATEGORIES.find((c) => c.words.test(text)) ?? null, title: text };
}

/** The name to store: the category's emoji, a space, then the title. */
export function nameWith(category: Category | null, title: string) {
  return category ? `${category.emoji} ${title.trim()}` : title.trim();
}

/** The contract counts a name's UTF-8 bytes (MAX_NAME_LEN = 32). */
export const nameBytes = (name: string) => new TextEncoder().encode(name).length;

/** Up to two lines of about `width` characters, broken at spaces; the rest is cut with an ellipsis. */
export function nameLines(title: string, width: number): string[] {
  const words = title.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if (!line) line = w;
    else if (`${line} ${w}`.length <= width) line = `${line} ${w}`;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  const out = lines.slice(0, 2).map((l) => (l.length > width ? `${l.slice(0, width - 1)}…` : l));
  if (lines.length > 2) out[1] = `${out[1].slice(0, width - 1).replace(/\s+$/, "")}…`;
  return out;
}
