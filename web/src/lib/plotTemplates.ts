export interface PlotBeat {
  id: string;
  name: string;
  description: string;
  /** Approximate position in the story (0-100 %) */
  position: number;
}

export interface PlotTemplate {
  id: string;
  name: string;
  description: string;
  compendiumSection?: string; // links into Writer's Compendium section id
  beats: PlotBeat[];
}

/** Maps template id → compendium section id */
export const TEMPLATE_COMPENDIUM_SECTION: Record<string, string> = {
  "three-act":       "10.1",
  "save-the-cat":    "10.2",
  "heros-journey":   "10.3",
  "seven-point":     "10.4",
  "eight-point-arc": "10.5",
  "freytag":         "10.7",
};

export const PLOT_TEMPLATES: PlotTemplate[] = [
  {
    id: "save-the-cat",
    name: "Save the Cat",
    description: "Blake Snyder's 15-beat Hollywood structure.",
    beats: [
      { id: "stc-01", name: "Opening Image",         description: "A snapshot of the hero's world before the journey begins — sets tone and stakes.",               position: 1 },
      { id: "stc-02", name: "Theme Stated",           description: "Someone (not the hero) hints at what the story is really about.",                               position: 5 },
      { id: "stc-03", name: "Set-Up",                 description: "Introduce the hero, their world, and everything that needs to change.",                         position: 10 },
      { id: "stc-04", name: "Catalyst",               description: "The inciting incident — the moment that disrupts the hero's world.",                            position: 12 },
      { id: "stc-05", name: "Debate",                 description: "The hero debates what to do, resisting the call to action.",                                    position: 15 },
      { id: "stc-06", name: "Break Into Two",         description: "The hero makes a choice and enters a new world — Act 2 begins.",                               position: 25 },
      { id: "stc-07", name: "B Story",                description: "A secondary story (often a love story) that carries the theme.",                               position: 30 },
      { id: "stc-08", name: "Fun and Games",          description: "The premise is explored; the hero tries to thrive in the new world.",                          position: 40 },
      { id: "stc-09", name: "Midpoint",               description: "A false victory or false defeat — raises stakes and shifts direction.",                        position: 50 },
      { id: "stc-10", name: "Bad Guys Close In",      description: "Internal and external antagonists regroup; the hero's team falls apart.",                      position: 60 },
      { id: "stc-11", name: "All Is Lost",            description: "The worst moment — all hope seems gone. Often includes a 'whiff of death'.",                   position: 75 },
      { id: "stc-12", name: "Dark Night of the Soul", description: "The hero wallows in despair before finding the will to push on.",                              position: 78 },
      { id: "stc-13", name: "Break Into Three",       description: "A new idea (often from the B Story) gives the hero a way forward — Act 3 begins.",            position: 80 },
      { id: "stc-14", name: "Finale",                 description: "The hero executes the new plan, defeats the antagonist, and proves they've changed.",          position: 85 },
      { id: "stc-15", name: "Final Image",            description: "Mirror of the Opening Image — shows how much the world and the hero have changed.",            position: 99 },
    ],
  },
  {
    id: "heros-journey",
    name: "Hero's Journey",
    description: "Joseph Campbell's monomyth — 12 stages found across myths and modern stories.",
    beats: [
      { id: "hj-01", name: "Ordinary World",      description: "The hero's normal life before the adventure — establishes contrast.", position: 2 },
      { id: "hj-02", name: "Call to Adventure",   description: "A challenge or quest is presented to the hero.",                       position: 10 },
      { id: "hj-03", name: "Refusal of the Call", description: "The hero hesitates or refuses out of fear.",                          position: 15 },
      { id: "hj-04", name: "Meeting the Mentor",  description: "A wise figure gives advice, tools, or confidence.",                   position: 20 },
      { id: "hj-05", name: "Crossing the Threshold", description: "The hero commits to the adventure and enters the special world.", position: 25 },
      { id: "hj-06", name: "Tests, Allies, Enemies", description: "The hero faces challenges and makes friends and foes.",           position: 35 },
      { id: "hj-07", name: "Approach to the Inmost Cave", description: "Preparation for the supreme ordeal.",                       position: 45 },
      { id: "hj-08", name: "Ordeal",              description: "The central crisis — a near-death experience or great challenge.",   position: 50 },
      { id: "hj-09", name: "Reward (Seizing the Sword)", description: "The hero survives and takes the prize.",                     position: 60 },
      { id: "hj-10", name: "The Road Back",       description: "The hero begins the journey home; the adventure isn't over.",       position: 70 },
      { id: "hj-11", name: "Resurrection",        description: "A final climax — the hero is transformed by a final ordeal.",       position: 85 },
      { id: "hj-12", name: "Return with the Elixir", description: "The hero returns home changed, with something to improve the ordinary world.", position: 97 },
    ],
  },
  {
    id: "seven-point",
    name: "Seven-Point Structure",
    description: "Dan Wells' simple but powerful 7-point framework — work backwards from the end.",
    beats: [
      { id: "sp-01", name: "Hook",           description: "The starting point — the opposite state from where the story ends. Grab the reader immediately.", position: 1 },
      { id: "sp-02", name: "Plot Turn 1",    description: "The call to adventure — something happens that sets the story in motion.",                         position: 20 },
      { id: "sp-03", name: "Pinch Point 1",  description: "Apply pressure — show the antagonist's power and raise the stakes for the hero.",                 position: 37 },
      { id: "sp-04", name: "Midpoint",       description: "The character moves from reacting to acting — a shift from passive to proactive.",                position: 50 },
      { id: "sp-05", name: "Pinch Point 2",  description: "Apply more pressure — things look worst here; the hero seems certain to fail.",                   position: 62 },
      { id: "sp-06", name: "Plot Turn 2",    description: "The hero gets the final tool, knowledge, or resolve needed to reach the resolution.",             position: 80 },
      { id: "sp-07", name: "Resolution",     description: "The end state — the mirror of the Hook, showing how far the character has come.",                 position: 99 },
    ],
  },
  {
    id: "three-act",
    name: "Three-Act Structure",
    description: "The classical foundation — Setup, Confrontation, Resolution. Universal and genre-agnostic.",
    beats: [
      { id: "ta-01", name: "Act I — Setup",         description: "Establish protagonist, world, and status quo. Ends when the hero commits to the central journey — no going back.", position: 25 },
      { id: "ta-02", name: "Act II — Confrontation", description: "Protagonist pursues the goal across escalating obstacles. Midpoint shifts direction. Ends at the darkest moment.", position: 75 },
      { id: "ta-03", name: "Act III — Resolution",   description: "Protagonist uses what they have learned to confront the central conflict. Climax. New equilibrium.",              position: 100 },
    ],
  },
  {
    id: "eight-point-arc",
    name: "Eight-Point Arc",
    description: "Nigel Watts' gentle framework — great for literary fiction and short stories. Emphasises how the quest evolves.",
    beats: [
      { id: "epa-01", name: "Stasis",          description: "The ordinary world before disruption. Shows what the character has to gain or lose. Best stasis already contains the seed of change.", position: 0 },
      { id: "epa-02", name: "Trigger",         description: "An event beyond the protagonist's control that disturbs the stasis and starts the chain of events. Can be dramatic or quiet.", position: 10 },
      { id: "epa-03", name: "Quest",           description: "The protagonist pursues a goal. The quest should EVOLVE — what begins as a quest for money may become a quest for meaning.", position: 25 },
      { id: "epa-04", name: "Surprise",        description: "An unexpected event that complicates the quest. Must arise naturally — not feel random. Forces the protagonist to adapt.", position: 45 },
      { id: "epa-05", name: "Critical Choice", description: "The protagonist must decide under maximum pressure. No easy option. What they choose reveals who they really are.", position: 62 },
      { id: "epa-06", name: "Climax",          description: "Point of maximum tension. The result of all previous surprises and choices. In literary fiction this is often an internal confrontation.", position: 75 },
      { id: "epa-07", name: "Reversal",        description: "The situation changes fundamentally as a result of the climax. The protagonist's world — internal and external — is permanently altered.", position: 88 },
      { id: "epa-08", name: "Resolution",      description: "The new stasis. Should mirror and contrast with the opening. The natural consequence of everything that came before — happy or not.", position: 99 },
    ],
  },
  {
    id: "freytag",
    name: "Freytag's Pyramid",
    description: "Gustav Freytag's classical five-stage arc (1863). Foundation of European dramatic theory — especially suited to tragedy.",
    beats: [
      { id: "fr-01", name: "Exposition",     description: "Introduction of characters, setting, and background. Establish the world before the conflict begins.", position: 12 },
      { id: "fr-02", name: "Rising Action",  description: "A series of complications and obstacles that build tension toward the climax. The protagonist struggles and grows.", position: 45 },
      { id: "fr-03", name: "Climax",         description: "The turning point — the moment of highest tension and decision. Everything before has led here; everything after flows from it.", position: 75 },
      { id: "fr-04", name: "Falling Action", description: "Consequences of the climax unfold. Tension decreases but the outcome remains uncertain. Loose threads are gathered.", position: 88 },
      { id: "fr-05", name: "Dénouement",     description: "Resolution and new equilibrium. The final state of the world — characters and conflicts are resolved, one way or another.", position: 99 },
    ],
  },
];
