# Vale Multilingual Style Rules — Evaluation Report

**Evaluated:** All 60 YAML rule files across 9 languages (EN, DE, FR, ES, IT, PT, SV, DA, NO).  
**Date:** 2026-07-01

---

## Executive Summary

The project is well-structured, extensively sourced, and covers a wide range of style issues across European languages. However, **several rule categories are currently unusable in production due to massive false-positive rates** or actual syntax bugs. The biggest problems are:

1. **Passive rules** — flag extremely common auxiliary verbs across all languages.
2. **WeaselWords rules** — flag everyday words like *sehr*, *très*, *muy*, *molto*, *problématique*, *übrigens*.
3. **Buzzwords rules** — flag legitimate technical terms (*agile*, *KPI*, *innovation*, *digital*, *stakeholder*).
4. **Critical substitution bugs** — literal arrows/colons in replacement strings in 6 language files.
5. **Double-flagging** — hedging phrases appear in both WeaselWords and FauxAmis/FalscheFreunde/etc.

**Verdict:** The **Redundancy**, **NominalStyle**, **WordyPhrases** (mostly), **FauxAmis** (mostly), and **Anglicism** rules are solid and valuable. The **Passive**, **WeaselWords**, and **Buzzwords** rules need major pruning or complete rewrites before they are usable.

---

## Critical Bugs (Broken Rules — Will Produce Wrong Suggestions)

These are syntax/logic errors where Vale will literally suggest the wrong text.

| # | Language | File | Broken Entry | What Vale Suggests | What It Should Suggest |
|---|----------|------|--------------|-------------------|------------------------|
| 1 | **DE** | `ReflexiveVerbs.yml` | `es gibt keine: kein` | `kein` (e.g., "kein Probleme") | `keine` or remove this block entirely |
| 2 | **DE** | `WordyPhrases.yml` | `dies liegt daran dass: das liegt daran: denn` | `das liegt daran: denn` (colon included) | `denn` or `weil` |
| 3 | **IT** | `WordyPhrases.yml` | `si precisa che: si precisa che → si specifica che` | `si precisa che → si specifica che` | `si specifica che` |
| 4 | **IT** | `WordyPhrases.yml` | `si sottolinea che: si sottolinea → si ricorda che` | `si sottolinea → si ricorda che` | `si ricorda che` |
| 5 | **IT** | `WordyPhrases.yml` | `in un'ottica di: in un'ottica di → per` | `in un'ottica di → per` | `per` |
| 6 | **FR** | `WordyPhrases.yml` | `compte tenu du fait que: compte tenu du fait que → puisque` | `compte tenu du fait que → puisque` | `puisque` |
| 7 | **PT** | `WordyPhrases.yml` | `a título informativo: a título informativo → para informação` | `a título informativo → para informação` | `para informação` |
| 8 | **PT** | `NominalStyle.yml` | `tomar conhecimento de: tomar nota de → inteirar-se de` | `tomar nota de → inteirar-se de` | `inteirar-se de` |
| 9 | **DA** | `WordyPhrases.yml` | `hvad angår: om / hvad angår → om` | `om / hvad angår → om` | `om` |
| 10 | **DA** | `NominalStyle.yml` | `tage ansvar for: tage ansvar for → stå til ansvar` | `tage ansvar for → stå til ansvar` | `stå til ansvar` |
| 11 | **NO** | `NominalStyle.yml` | `ta ansvar for: ta ansvar for → stå ansvarlig for` | `ta ansvar for → stå ansvarlig for` | `stå ansvarlig for` |

### Also notable:
- **FR `Redundancy.yml`**: `s'avérer faux: se révéler faux` — this is inconsistent with `s'avérer vrai: s'avérer` (the redundant "faux" should simply be removed, not replaced with a different verb).

---

## Major Issues (High False-Positive Risk — Rules That Will Drown Users in Noise)

### 1. Passive Rules — Broken Across All 9 Languages

The passive rules use `existence` with extremely broad tokens. They will flag **almost every sentence** in a typical text because they match the most common auxiliary verbs in each language.

| Language | Token Examples | Problem |
|----------|---------------|---------|
| **DE** | `\bwurde\b`, `\bwurden\b`, `\bworden\b` | Will flag every German passive. Academic/technical writing is impossible to check. |
| **FR** | `\best [a-zàâäéèêëîïôùûüÿç]+é\b` | Matches **any adjective or participle ending in -é after "est"** → "est fatigué", "est arrivé", "est allé" (all active/intransitive). Massive false positives. |
| **FR** | `\bfut\b`, `\bfurent\b` | Matches passé simple of *être* — will flag every passive sentence in literary/academic French. |
| **ES** | `\bfue\b`, `\bfueron\b` | Matches preterite of both **ser** (passive) and **ir** (to go). "Fue a casa" (active) will be flagged. |
| **IT** | `\bviene\b`, `\bvengono\b` | These are present tense of *venire* (to come). Active sentences like "viene a casa" will be flagged. |
| **PT** | `\bfoi\b`, `\bforam\b` | Matches preterite of both **ser** (passive) and **ir** (to go). Same Spanish problem. |
| **SV** | `\bär\b`, `\bvar\b`, `\bblir\b` | "Är" = "is", "var" = "was", "blir" = "becomes". These are among the most common words in Swedish. |
| **DA** | `\ber\b`, `\bvar\b`, `\bbliver\b` | Same as Swedish — "er" = "is", "bliver" = "becomes". |
| **NO** | `\ber\b`, `\bvar\b`, `\bblir\b` | Same as Swedish. |
| **SV/DA/NO** | `\bman\b` | "Man" is the impersonal pronoun (like English "one"). It is standard and extremely common. Flagging it is hyper-prescriptive. |
| **EN** | *(no Passive rule)* | — |

**Recommendation:** Passive rules should be **removed entirely** or rewritten using context-aware patterns (e.g., matching `auxiliary + past participle` as a phrase, not single words). For French, the `est […]+é` pattern is particularly dangerous and should be deleted immediately.

### 2. WeaselWords — Too Broad Across All Languages

These rules flag extremely common words that are perfectly legitimate in most contexts. They will fire on almost every paragraph.

| Language | Examples of Overly Broad Flags |
|----------|-------------------------------|
| **DE** | `sehr`, `wirklich`, `natürlich`, `verschiedene`, `bestimmte`, `übrigens`, `eigentlich`, `irgendwie`, `aktuell` |
| **FR** | `très`, `vraiment`, `complètement`, `naturellement`, `apparemment`, `actuellement`, `aujourd'hui`, `en ce qui concerne`, `par rapport à`, `chose`, `problématique`, `thématique` |
| **ES** | `muy`, `realmente`, `totalmente`, `obviamente`, `actualmente`, `en la actualidad`, `a día de hoy`, `tema`, `asunto`, `cuestión`, `por parte de`, `a nivel de` |
| **IT** | `molto`, `davvero`, `completamente`, `naturalmente`, `ovviamente`, `attualmente`, `oggigiorno`, `cosa`, `problematica`, `tematica`, `nell'ambito di`, `per quanto riguarda` |
| **PT** | `muito`, `bastante`, `completamente`, `evidentemente`, `claramente`, `atualmente`, `nos dias de hoje`, `coisa`, `negócio`, `problemática`, `no âmbito de`, `no que concerne a` |
| **SV** | `väldigt`, `mycket`, `faktiskt`, `naturligtvis`, `uppenbarligen`, `för tillfället`, `i nuläget`, `numera`, `sak`, `fråga`, `inom ramen för`, `med avseende på` |
| **DA** | `meget`, `ret`, `faktisk`, `naturligvis`, `åbenbart`, `for øjeblikket`, `i øjeblikket`, `nu til dags`, `ting`, `sag`, `inden for rammerne af`, `med hensyn til` |
| **NO** | `veldig`, `svært`, `faktisk`, `naturligvis`, `åpenbart`, `for øyeblikket`, `for tiden`, `nå om dagen`, `ting`, `sak`, `innenfor rammene av`, `med hensyn til` |

**Recommendation:** These rules should be **pruned by 70–80%**. Keep only genuinely vague bureaucratic filler (e.g., DE: `diesbezüglich`, `dahingehend`, `im Rahmen` in formal contexts; FR: `au niveau de` when used vaguely; ES: `el hecho de que`, `la circunstancia de que`). Remove all common intensifiers, time expressions, and standard academic connectors.

### 3. Buzzwords — Flags Legitimate Technical Terms and Normal Adjectives

These rules are extremely context-dependent and will generate false positives in business, tech, and academic writing.

**Terms that are standard and should NOT be flagged:**
- `agile`, `scrum`, `lean`, `sprint` — standard software/PM terminology
- `KPI`, `ROI`, `OKR` — standard business acronyms
- `innovation`, `innovative`, `digital`, `transformation` — legitimate concepts, not buzzwords in context
- `stakeholder`, `roadmap`, `startup`, `ecosystem` — standard business terms
- `resilience`, `resilient` — technical terms in psychology, engineering, climate science
- `dynamic`, `flexible`, `modern`, `intelligent`, `smart` — normal adjectives
- `excellent`, `competent`, `engaged`, `transparent` — normal positive adjectives
- `sustainability`, `nachhaltig`, `nachhaltigkeit` — critical policy/environmental terms
- `optimize`, `maximize`, `minimize` — standard verbs
- `game changer`, `think outside the box`, `win-win` — legitimate idioms
- `governance`, `co-creation`, `empowerment` — standard social-science/public-admin terms

**Recommendation:** Remove or significantly trim these rules. Keep only the most egregious corporate clichés (e.g., *synergy*, *paradigm shift*, *disruption*, *best practice*, *value-added* phrases). Consider splitting into a separate optional package.

### 4. Double-Flagging — Same Phrases in Two Rules

Personal hedging phrases appear in **both** WeaselWords and the language-specific "false friends/errors" rule. Users will get two alerts for the same phrase.

| Phrase | Languages Affected |
|--------|-------------------|
| `from my point of view` / `in my opinion` / `personally I think` | **FR**, **ES**, **IT**, **PT**, **SV**, **DA**, **NO** |
| `meiner Meinung nach` / `ich finde dass` | **DE** (FalscheFreunde) |

**Recommendation:** Remove hedging phrases from the false-friend/error rules and keep them only in WeaselWords (or vice versa). Do not duplicate.

---

## Moderate Issues (Debatable or Context-Dependent Rules)

### NominalStyle — Some Substitutions Change Meaning

| Language | Entry | Issue |
|----------|-------|-------|
| **DE** | `Anteil nehmen: mitfühlen` | Wrong meaning. *Anteil nehmen* = to share/participate; *mitfühlen* = to sympathize. |
| **DE** | `Anstoß nehmen an: sich stoßen an` | *Sich stoßen an* is not standard German. |
| **DE** | `ein Gespräch führen: sprechen` | Changes register and meaning. *Ein Gespräch führen* is formal/structured; *sprechen* is generic. |
| **DE** | `eine Rede halten: reden` | *Eine Rede halten* = to give a speech; *reden* = to talk. Very different. |
| **DE** | `Vorsorge treffen: vorsorgen` | *Vorsorgen* is non-standard; correct is *Vorsorge treffen* or *vorher sorgen*. |
| **DE** | `Maßnahmen treffen: handeln` | *Handeln* = to act; *Maßnahmen treffen* = to take measures. Different specificity. |
| **DE** | `an die Hand geben: geben` | *An die Hand geben* = to hand over; *geben* = to give. Different. |
| **DE** | `zu Rate ziehen: befragen` | *Zu Rate ziehen* = to consult; *befragen* = to interrogate. Different. |
| **DE** | `in Höhe von: über` | *In Höhe von* = in the amount of; *über* = over. Different. |
| **EN** | `plan ahead: plan` | *Plan ahead* implies advance planning; *plan* is generic. |
| **EN** | `close down: close` | *Close down* = permanent shutdown; *close* = temporary. |
| **EN** | `open up: open` | *Open up* = become communicative / open new area; *open* = generic. |
| **EN** | `safe haven: haven` | *Safe haven* is a specific term in finance/politics. |
| **EN** | `future plans: plans` | *Future* can distinguish from current plans. Debatable. |
| **FR** | `dans le cadre de: dans / pour` | Often oversimplifies; *dans le cadre de* implies scope/framework. |
| **FR** | `à la suite de: après` | *À la suite de* can mean "as a result of"; *après* = after. |
| **IT** | `sulla base di: secondo` | *Sulla base di* = based on; *secondo* = according to. |
| **IT** | `in funzione di: secondo` | *In funzione di* = depending on; *secondo* = according to. |
| **IT** | `a fronte di: di fronte a` | *A fronte di* = in view of / given; *di fronte a* = facing. |
| **PT** | `a título de: como` | *A título de* = by way of; *como* = as. Not always equivalent. |
| **PT** | `em termos de: em / do ponto de vista de` | *Em termos de* = in terms of; replacement loses meaning. |
| **SV** | `i och med: när / med` | *I och med* = in connection with / since; replacements are incomplete. |
| **SV** | `på basis av: utifrån / enligt` | *På basis av* = based on; *utifrån* = from the perspective of. |

### FauxAmis / Error Rules — Some Are Overly Prescriptive

| Language | Entry | Issue |
|----------|-------|-------|
| **DE** | `meiner Meinung nach`, `ich finde dass`, `ich denke dass` | These are legitimate hedging in opinion pieces, reviews, essays. Not errors. |
| **DE** | `derselbe`, `dieselbe`, `dasselbe` | These are **correct** when referring to the identical object. The rule only warns, but will still flag correct usage. |
| **DE** | `scheinbar` | Legitimate word; only sometimes confused with *anscheinend*. Flagging every use is aggressive. |
| **FR** | `c'est eux`, `c'est elles`, `c'est nous`, `c'est vous` | Increasingly accepted in written French. The normative "ce sont" is becoming archaic. |
| **FR** | `actuellement` | Flagged in **both** FauxAmis and WeaselWords. Double alert. Also, *actuellement* is a standard time adverb. |
| **IT** | `piuttosto che` | The disjunctive use (*o*) is very common and increasingly accepted by the Accademia. |
| **ES** | `dicho esto` | Standard connector. Debatable to flag it. |
| **ES** | `sensible` patterns | Only match `una persona sensible` and `un enfoque sensible` — but *sensible* = sensitive is correct in Spanish. The rule will flag correct usage. |
| **ES** | `soportar` | Comment present but **no tokens** — rule is inactive. |

### Anglicism Rules — Some Recommendations Are Outdated or Regional

| Language | Entry | Issue |
|----------|-------|-------|
| **FR** | `email: courriel` | *Courriel* is official in Quebec but virtually unused in France. *E-mail* is standard. |
| **FR** | `smartphone: ordiphone` | *Ordiophone* is extremely rare; *smartphone* is universal. |
| **FR** | `tweet: gazouillis` | *Gazouillis* is the official recommendation but almost nobody uses it. |
| **FR** | `hashtag: mot-dièse` | Official but rarely used in practice. |
| **FR** | `selfie: égoportrait` | Almost never used. |
| **FR** | `wifi: sans-fil` | *Sans-fil* is not the common term; *wifi* is standard. |
| **FR** | `cloud: nuage` | *Nuage informatique* is official but *cloud* is standard. |
| **FR** | `big data: mégadonnées` | Official but rarely used. |
| **FR** | `spam: pourriel` | Quebec usage; *spam* is standard in France. |
| **FR** | `upload: téléversement` | Quebec usage; France uses *upload* or *mise en ligne*. |
| **FR** | `newsletter: infolettre` | Quebec usage; *lettre d'information* is the French standard. |
| **FR** | `feedback: rétroaction` | *Rétroaction* is Quebec; *retour* is standard in France. |
| **FR** | `startup: jeune pousse` | *Jeune pousse* is official but *startup* is universal. |
| **IT** | `influencer: influencer (accettato) / influente` | *Influente* is not a noun; the Italian standard is *influencer*. |
| **DE** | `Marketing: Vermarktung` | *Marketing* is fully standard in German. |
| **DE** | `Präsentation: Vortrag` | *Präsentation* is standard German; *Vortrag* is more formal/lecture-like. |
| **DE** | `Headquarter: Zentrale` | The English word is *Headquarters* (plural). *Headquarter* as singular is already wrong English. |
| **DE** | `Job: Stelle` | *Job* is extremely common and standard in German. |
| **DE** | `Manager: Leiter` | *Manager* is standard in German business. |

---

## Language-by-Language Summary

### 🇬🇧 English (Foliantica-EN) — ✅ Best Shape
**Rules:** Redundancy, NominalStyle  
**Status:** Solid and usable. Only 2 minor debatable entries (`close down`, `open up`, `safe haven`, `plan ahead`, `future plans`). No critical bugs. Intentionally minimal (fills gaps left by write-good/proselint).

### 🇩🇪 German (Foliantica-DE) — ⚠️ Needs Work
**Rules:** Passive, Redundancy, WeaselWords, WordyPhrases, NominalStyle, ReflexiveVerbs, Klischees, FalscheFreunde, Buzzwords, Anglizismen  
**Status:**
- ✅ **Redundancy** — Excellent, well-sourced, few false positives.
- ⚠️ **NominalStyle** — Mostly good but ~6 entries change meaning significantly.
- ⚠️ **WordyPhrases** — Good but some substitutions are oversimplified (`im Rahmen von: bei`).
- 🔴 **Passive** — Will flag every German text. Unusable.
- 🔴 **WeaselWords** — Will flag every paragraph. Unusable.
- 🔴 **ReflexiveVerbs** — `es gibt keine: kein` is a critical bug. The `es gibt` block is wrong.
- 🔴 **Buzzwords** — Flags normal adjectives and technical terms. Unusable.
- ⚠️ **Anglizismen** — Well-structured but many entries flag words that are fully standard in German (Job, Manager, Marketing, App, Link, Präsentation).
- ⚠️ **Klischees** — Good and specific, but "breite Mehrheit" is a legitimate political term.
- ⚠️ **FalscheFreunde** — `derselbe`, `scheinbar`, `aktuell` will produce false positives. The hedging phrases (`meiner Meinung nach`) are not errors.

### 🇫🇷 French (Foliantica-FR) — ⚠️ Needs Work
**Rules:** Passive, Redundancy, WeaselWords, FauxAmis, Buzzwords, Anglicismes, WordyPhrases, NominalStyle  
**Status:**
- ✅ **Redundancy** — Good, well-sourced.
- ✅ **NominalStyle** — Good.
- ⚠️ **WordyPhrases** — `compte tenu du fait que → puisque` has a critical arrow bug.
- 🔴 **Passive** — `est […]+é` pattern is the most broken rule in the entire project. Matches any adjective after *est*. Unusable.
- 🔴 **WeaselWords** — Extremely broad. Will flag almost every French text. Unusable.
- 🔴 **Buzzwords** — Same issues as other languages.
- ⚠️ **Anglicismes** — Many recommendations are Quebec-specific and unused in France (courriel, ordiphone, gazouillis, mot-dièse, égoportrait, téléversement, infolettre, rétroaction, jeune pousse). Should note regional differences or accept the English terms.
- ⚠️ **FauxAmis** — `c'est eux` is increasingly accepted. `actuellement` is double-flagged. Hedging phrases are duplicated in WeaselWords.

### 🇪🇸 Spanish (Foliantica-ES) — ⚠️ Needs Work
**Rules:** Passive, Redundancy, WeaselWords, ErroresComunes, Buzzwords, Anglicismos, WordyPhrases, NominalStyle  
**Status:**
- ✅ **Redundancy** — Good.
- ✅ **NominalStyle** — Good.
- ✅ **ErroresComunes** — Excellent. The queísmo and dequeísmo entries are very valuable. Gerundio errors are good. Missing tokens for `soportar`.
- ⚠️ **WordyPhrases** — Good.
- 🔴 **Passive** — `fue` matches both *ser* and *ir*. Will flag active sentences with *ir*. Unusable.
- 🔴 **WeaselWords** — Extremely broad. Unusable.
- 🔴 **Buzzwords** — Same issues.
- ⚠️ **Anglicismos** — Generally good with "aceite" notes.

### 🇮🇹 Italian (Foliantica-IT) — ⚠️ Needs Work
**Rules:** Passive, Redundancy, WeaselWords, FalsiAmici, Buzzwords, Anglicismi, WordyPhrases, NominalStyle  
**Status:**
- ✅ **Redundancy** — Good.
- ✅ **NominalStyle** — Good.
- ✅ **FalsiAmici** — Good entries for *eventualmente*, *attualmente*, *implementare*. `piuttosto che` is debatable.
- ⚠️ **WordyPhrases** — Three critical arrow bugs (`si precisa che →`, `si sottolinea che →`, `in un'ottica di →`).
- 🔴 **Passive** — `viene` and `vengono` are present tense of *venire* (to come). Will flag almost every active sentence containing them. Unusable.
- 🔴 **WeaselWords** — Extremely broad. Unusable.
- 🔴 **Buzzwords** — Same issues.
- ⚠️ **Anglicismi** — Good compromise with "accettato" notes. *Influente* as a noun for *influencer* is incorrect.

### 🇵🇹 Portuguese (Foliantica-PT) — ⚠️ Needs Work
**Rules:** Passive, Redundancy, WeaselWords, FalsosAmigos, Buzzwords, Estrangeirismos, WordyPhrases, NominalStyle  
**Status:**
- ✅ **Redundancy** — Good.
- ✅ **NominalStyle** — Good, but `tomar conhecimento de: tomar nota de → inteirar-se de` has an arrow bug.
- ✅ **FalsosAmigos** — Excellent. Very comprehensive (*eventualmente*, *atualmente*, *suportar*, *implementar*, *consistente*, *comprometido*, *endereçar*, *assumir*, *performar*, *ter senso*, *fazer sentido*, *grátis*, *mídias*).
- ⚠️ **WordyPhrases** — `a título informativo → para informação` has an arrow bug.
- 🔴 **Passive** — `foi` matches both *ser* and *ir*. Unusable.
- 🔴 **WeaselWords** — Extremely broad. Unusable.
- 🔴 **Buzzwords** — Same issues.
- ⚠️ **Estrangeirismos** — Good with "aceite" notes.

### 🇸🇪 Swedish (Foliantica-SV) — ⚠️ Needs Work
**Rules:** Passive, Redundancy, WeaselWords, SprakFel, Buzzwords, Anglicismer, WordyPhrases, NominalStyle  
**Status:**
- ✅ **Redundancy** — Good.
- ✅ **NominalStyle** — Good.
- ✅ **SprakFel** — Good (*realiserade att*, *implementera*, *facilitera*, *adressera*, *eventuellt*, *konsistent*, *supporta*).
- ⚠️ **WordyPhrases** — Good.
- 🔴 **Passive** — `är` = "is", `var` = "was", `blir` = "becomes", `man` = impersonal "one". These are the most common words in Swedish. Will flag every sentence. Unusable.
- 🔴 **WeaselWords** — Extremely broad. Unusable.
- 🔴 **Buzzwords** — Same issues.
- ⚠️ **Anglicismer** — Good with "accepterat" notes.

### 🇩🇰 Danish (Foliantica-DA) — ⚠️ Needs Work
**Rules:** Passive, Redundancy, WeaselWords, SprogFejl, Buzzwords, Anglicismer, WordyPhrases, NominalStyle  
**Status:**
- ✅ **Redundancy** — Good.
- ✅ **NominalStyle** — Good, but `tage ansvar for → stå til ansvar` has an arrow bug.
- ✅ **SprogFejl** — Good (*realiserede at*, *implementere*, *facilitere*, *adressere*, *eventuelt*, *konsistent*, *supportere*, *kompromittere*).
- ⚠️ **WordyPhrases** — `hvad angår → om` has an arrow bug.
- 🔴 **Passive** — Same as Swedish (`er` = "is", `var` = "was", `bliver` = "becomes", `man` = "one"). Unusable.
- 🔴 **WeaselWords** — Extremely broad. Unusable.
- 🔴 **Buzzwords** — Same issues.
- ⚠️ **Anglicismer** — Good with "accepteret" notes.

### 🇳🇴 Norwegian (Foliantica-NO) — ⚠️ Needs Work
**Rules:** Passive, Redundancy, WeaselWords, SprakFeil, Buzzwords, Anglisismer, WordyPhrases, NominalStyle  
**Status:**
- ✅ **Redundancy** — Good.
- ✅ **NominalStyle** — Good, but `ta ansvar for → stå ansvarlig for` has an arrow bug.
- ✅ **SprakFeil** — Good (*realiserte at*, *implementere*, *fasilitere*, *adressere*, *eventuelt*, *konsistent*, *supportere*, *kompromittere*).
- ⚠️ **WordyPhrases** — Good.
- 🔴 **Passive** — Same as Swedish (`er` = "is", `var` = "was", `blir` = "becomes", `man` = "one"). Unusable.
- 🔴 **WeaselWords** — Extremely broad. Unusable.
- 🔴 **Buzzwords** — Same issues.
- ⚠️ **Anglisismer** — Good with "akseptert" notes.

---

## Recommendations (Priority Order)

### 🔴 Immediate (Fix Before Any Release)

1. **Fix all 11 arrow/colon substitution bugs** listed in the Critical Bugs table. These produce literal wrong text in Vale's suggestions.
2. **Fix `s'avérer faux: se révéler faux`** in French Redundancy — should be `s'avérer faux: s'avérer`.
3. **Fix `es gibt keine: kein`** in German ReflexiveVerbs — either remove the block or change to `es gibt keine: keine` (but this is still awkward). Best: remove `es gibt` entries entirely.
4. **Disable or delete all Passive rules** across all 9 languages. They are broken by design with current `existence` tokens.

### 🟠 High Priority (Major Usability Improvements)

5. **Prune WeaselWords by 70–80%** across all languages. Remove all common intensifiers, standard time adverbs, and normal connectors. Keep only bureaucratic filler and genuinely vague hedges.
6. **Prune Buzzwords by 60–70%** across all languages. Remove all standard technical terms, normal adjectives, and legitimate concepts. Keep only the most vacuous corporate clichés.
7. **Remove duplicated hedging phrases** from FauxAmis/FalscheFreunde/SprakFeil files. Keep them only in WeaselWords.
8. **Fix French Anglicismes** to reflect France usage: `email` → `e-mail` (not `courriel`), `smartphone` → `smartphone` (not `ordiphone`), `tweet` → `tweet` (not `gazouillis`), `hashtag` → `hashtag` (not `mot-dièse`), `wifi` → `wifi` (not `sans-fil`), `cloud` → `cloud` (not `nuage`), `big data` → `big data` (not `mégadonnées`), `spam` → `spam` (not `pourriel`), `upload` → `upload` (not `téléversement`), `newsletter` → `lettre d'information` (not `infolettre`), `feedback` → `retour` (not `rétroaction`), `startup` → `startup` (not `jeune pousse`).
9. **Fix German NominalStyle** entries that change meaning: `Anteil nehmen: mitfühlen` → `teilnehmen` or `sich beteiligen`; `Anstoß nehmen an: sich stoßen an` → `sich ärgern über` or `beanstanden`; `ein Gespräch führen: sprechen` → `sprechen` (with a note that register changes); `eine Rede halten: reden` → `eine Rede halten` (remove); `Vorsorge treffen: vorsorgen` → `Vorsorge treffen` (remove); `Maßnahmen treffen: handeln` → `Maßnahmen ergreifen` or remove.
10. **Fix English Redundancy** entries: `close down: close` → remove or add context; `open up: open` → remove or add context; `safe haven: haven` → remove; `plan ahead: plan` → remove.

### 🟡 Medium Priority (Quality Improvements)

11. **Add context/scoping** to WeaselWords and Buzzwords. Use `scope: sentence` or more specific regex patterns to reduce false positives.
12. **Note regional differences** in anglicism rules more clearly. Quebec vs. France vs. Belgium vs. Switzerland usage varies significantly.
13. **Fix `sensible` and `soportar` in Spanish ErroresComunes**: add `soportar` tokens, and reconsider whether `sensible` patterns are useful (they will flag correct usage of "sensitive").
14. **Fix `piuttosto che` in Italian FalsiAmici**: either remove or soften the message, as this usage is increasingly accepted.
15. **Fix `c'est eux` in French FauxAmis**: soften the message or remove, as this is increasingly accepted in modern French.
16. **Fix `derselbe` message in German FalscheFreunde**: clarify that it's only a warning for potential misuse, not a universal error.
17. **Consider adding `scope: paragraph` or `scope: sentence`** to NominalStyle and WordyPhrases to reduce noise, though these are less problematic.

### 🟢 Low Priority (Nice-to-Have)

18. **Standardize message formats** across all languages (some use `'%s'`, others use `"%s"`).
19. **Add more French-specific pleonasms** (e.g., *monter en haut*, *descendre en bas* are already there — good).
20. **Consider creating an optional `Foliantica-XX-Business` package** for the aggressive buzzword rules, so users can opt in rather than being overwhelmed by default.
21. **Add tests** — create a `tests/` directory with sample texts for each language to verify that rules produce expected alerts and no unexpected false positives.

---

## Appendix: Files Evaluated

| Package | Files | Count |
|---------|-------|-------|
| `Foliantica-EN` | Redundancy, NominalStyle | 2 |
| `Foliantica-DE` | Passive, Redundancy, WeaselWords, WordyPhrases, NominalStyle, ReflexiveVerbs, Klischees, FalscheFreunde, Buzzwords, Anglizismen | 10 |
| `Foliantica-FR` | Passive, Redundancy, WeaselWords, FauxAmis, Buzzwords, Anglicismes, WordyPhrases, NominalStyle | 8 |
| `Foliantica-ES` | Passive, Redundancy, WeaselWords, ErroresComunes, Buzzwords, Anglicismos, WordyPhrases, NominalStyle | 8 |
| `Foliantica-IT` | Passive, Redundancy, WeaselWords, FalsiAmici, Buzzwords, Anglicismi, WordyPhrases, NominalStyle | 8 |
| `Foliantica-PT` | Passive, Redundancy, WeaselWords, FalsosAmigos, Buzzwords, Estrangeirismos, WordyPhrases, NominalStyle | 8 |
| `Foliantica-SV` | Passive, Redundancy, WeaselWords, SprakFel, Buzzwords, Anglicismer, WordyPhrases, NominalStyle | 8 |
| `Foliantica-DA` | Passive, Redundancy, WeaselWords, SprogFejl, Buzzwords, Anglicismer, WordyPhrases, NominalStyle | 8 |
| `Foliantica-NO` | Passive, Redundancy, WeaselWords, SprakFeil, Buzzwords, Anglisismer, WordyPhrases, NominalStyle | 8 |
| **Total** | | **60** |
