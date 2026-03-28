# 🌌 The Evolution Engine: UX & Advanced Interactions

DreamBees transcends standard image generation by providing a sophisticated suite of creative tools known as the **Evolution Engine**. This system allows users to perform surgical edits, explore divergent artistic dimensions, and track the narrative history of their creations.

---

## 🧬 Core Evolution Mechanics

The Evolution Engine is primarily driven by the `/remix` suite, which uses **Relative Strength** and **Context-Aware Prompting** to transform existing images.

### 1. 🌈 Visual DNA Match
This feature captures the "aesthetic essence" of a specific image—its color palette, lighting, and mood—and applies it to a completely new subject.
- **Mimicry**: Stored on the user's profile, the DNA match ensures consistency across 100% divergent subjects.
- **Workflow**: `Lock Style` ➔ `Generate Match` ➔ `manifestation`.

### 2. 💎 Prism of Dimensions
Split your vision into four divergent artistic realms simultaneously.
- **Mythic**: Aetheric and magical.
- **Chrome**: Cybernetic and dystrophic.
- **Primal**: Raw natural power.
- **Gothic**: Macabre and obsidian elegance.
- **Impact**: Provides a 2x2 grid representing the same concept projected into four distinct "realms".

---

## 🏗️ Narrative Context & Lineage

DreamBees treats every creation as part of a larger story.

### 3. ⏳ The Lineage Mural
A specialized stitching process that creates a 3-stage narrative strip of your creative journey.
- **Visual Path**: Root Image (Start) ➔ Parent Image (Middle) ➔ Apex Creation (Current).
- **Purpose**: Ideal for documenting the iterative process and storyboarding.

### 4. 🧭 Variation Neighborhoods
Rather than guessing prompts, users can explore a "spectrum of creativity" by generating four variations of a single image with increasing **Strength** values (0.5 to 0.95).
- **Spectrum**: Subtle refinements ➔ Dramatic evolutions.

---

## 🧠 AI-Powered Creative Coaching

### 5. 🔮 Genius Suggestions
The "Supreme Alchemist" (powered by Gemini) analyzes your current image and suggests three distinct, creative directions for the next evolution.
- **Interactive UX**: Suggestions are presented as easy-access buttons for instant transformation.

### 6. 🧠 Alchemist's Insight
Every remix response includes a unique, mystical critique or creative hint to help guide the user's next artistic choice.

---

## 🔪 Surgical Edits (Contextual Focus)

To prevent the "everything changes" problem in generic image remixing, the Evolution Engine supports **Surgical Focus**:
- **Subject focus**: Modify the character or object while keeping the environment locked.
- **Environment focus**: Swap the background or atmosphere while preserving the character's pose and features.

---

## 🛠️ Technical implementation

These systems are orchestrated in `interactions/remix.js` and `interactions/mockup.js`, utilizing the `image-processor.js` for complex stitching operations (`stitchNarrativeStrip`, `stitchSideBySide`).
