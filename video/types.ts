/** A video's structure (video/<id>/outline.ts). Words live in video/<id>/<lang>.json. */
export interface VideoOutline {
  id: string;
  scenes: OutlineScene[];
}

export interface OutlineScene {
  /** Stable id: MP3 names and the language files key on it */
  id: string;
  kind: "card" | "live";
  silenceAfter: number;
  /** Cards: template in video/cards/, plus props that don't depend on language */
  template?: string;
  props?: Record<string, unknown>;
  /** Live: the drive plan, in order (the recorder implements it in video/<id>/actions.ts) */
  steps?: string[];
}

/** One scene's words in one language */
export interface SceneScript {
  text: string;
  /** Card text, merged over the outline's props */
  card?: Record<string, unknown>;
  /** Caption text when it differs from what's spoken (e.g. a web address) */
  caption?: string;
}
