# Blog Voice Guide

Derived from the three existing posts: [The Campus Market](public/tcm.html) (2019), [Sovy io](public/sovy.html) (2018), [RentSoft](public/rentsoft.html) (2023).

This is a working document. Strike anything that doesn't sound like you, add anything I missed, and I'll rewrite the KeepTrack post against the final version.

---

## 0. Hard rules (non-negotiable)

### Never use an em dash. Ever.

This applies to every piece of copy drafted for this site, not just blog posts.

Banned characters: `—` (em dash) and `–` (en dash), including in number ranges. Also banned: ` - ` (a spaced hyphen doing the job of a dash), which is the same construction wearing a disguise.

When a dash feels like the right punctuation, use one of these instead:

| Instead of a dash | Use |
|---|---|
| Joining two related independent clauses | A semicolon |
| An abrupt turn or afterthought | A new sentence |
| An aside or clarification | Parentheses |
| Introducing a list or explanation | A colon |
| A number range (`3–5`) | The word "to", or a plain hyphen (`3-5`) |

Rewritten examples:

> ~~"That's a real departure — two of the three posts are team stories."~~
> "That is a real departure; two of the three posts are team stories."

> ~~"The things that saved me were boring - a documented design system, a single file of types."~~
> "The things that saved me were boring: a documented design system and a single file of types."

> ~~"Here I am the user - I find the friction the same week I ship it."~~
> "Here I am the user. I find the friction the same week I ship it."

**Note on the current KeepTrack draft:** it contains zero actual em dash characters. What is all over it is the third form, ` - ` used as a dash, 15 times. (For what it's worth, the em dashes you were reading were in the first version of *this document*, which had 12 of them. They are gone now.) The rule covers all three forms so the distinction never has to come up again.

## 1. The shape of a post

Every post uses the same five `<h2 class="blog-header">` sections, in this order:

| Section | Job |
|---|---|
| What was it? | One paragraph. Plain description of the thing, plus who you built it with (linked). |
| Why did we build it? | The origin story. A specific personal frustration, told as a narrative with dates and places. |
| What did it do? | The bulk of the post. Broken into `<h4>` feature subsections, each with a screenshot. |
| What did I learn? | 3 to 5 lessons. Each is a one-line claim in a `<p>`, then a `<ul>` of 2 to 4 supporting bullets. |
| How did it go? | The honest outcome. Money, users, why it ended. |

**Deviations that are already precedent:**
- Sovy skips "What did I learn?" entirely and folds the reflection into "How did it go?". The five sections aren't mandatory.
- RentSoft's last heading is "How did it go" with no question mark. Nobody noticed.
- Section headers are questions in past tense because all three posts are post-mortems.

**Open question for KeepTrack:** it's the first project that isn't dead. Options are (a) keep past tense and write it as a retrospective on building it, or (b) shift to present tense: "What is it? / Why did I build it? / What does it do?". My first draft used (b). Your call; it changes the whole feel.

## 2. Sentence and paragraph rhythm

Measured across the three posts:

| | Your posts | My first KeepTrack draft |
|---|---|---|
| Average sentence | **19 to 23 words** | 16.8, too clipped |
| Average paragraph | **47 to 77 words** | 44, too choppy |
| Contractions | **8 to 15 per 1,000 words** | 39.7, way too casual |
| Dash asides of any form | **1 in three posts** | 15, a tic I invented for you |
| Parenthetical asides | **13 across three posts** | 1, underused |

The headline finding: **you write more formally than a "casual blog voice" prompt would produce.** Long, complete, comma-spliced-but-grammatical sentences. Paragraphs that run 4 to 6 sentences and develop one idea fully before stopping. The personality comes from *what* you say, not from clipped fragments or heavy contraction use.

**RULES:**
- No dashes of any kind. See §0.
- Put asides in parentheses. That's your move: *"(of which there are many)"*, *"(ask me about the rewards points history tab)"*, *"(easier said than done)"*, *"(something we actively stopped)"*.
- Use `i.e.` to introduce examples, not "like" or "such as": *"(i.e. Facebook groups, KSL Classifieds, Craigslist)"*, *"(i.e. ringing up someone for concessions was a one-click add)"*.
- Let sentences run long. Resist the urge to break them up.

## 3. Person and tense

- **"We" when it was a team, "I" when it was you alone.** TCM and RentSoft are dominated by "we" (20 and 27 uses). The "I" moments are reserved for things only you did: the ETL scripts, the Briggslist class project, the manual reposting.
- **"You" for walking the reader through the product.** Sovy leans on it heavily (18 uses) because it's explaining an experience: *"when you signed up for the Sovy service you would start to receive phishing emails."*
- KeepTrack is a solo project, so it's "I" throughout. That is a real departure; two of the three existing posts are team stories, and part of their warmth comes from the "we." Worth being deliberate about.

## 4. What the voice actually does

**Self-deprecation, specific and unforced.** Never fishing for reassurance, always attached to a concrete artifact:
> *"I called it Briggslist (a play on Brigham and Craigslist) and boy was it ugly - just take a look."*
> *"So yeah... I never really wanted to be a web designer/front-end engineer anyway."*
> *"Surprising no one but ourselves, we launched and had 0 users after the first week."*
> *"This is a screenshot of the old software Top Hat was using, pretty isn't it?"*

(That first quote is the one ` - ` in the entire back catalogue. §0 supersedes it.)

**Concrete numbers over adjectives.** 200 active users. 300 listings. 4:30am. 40 years in business. $205,000. Three customers per account. You almost never write "a lot" when you could write the number.

**Named people, linked.** Joe Wesemann and Spencer Dixon get links every time. Alex Campbell, Ben, Greg. You credit people by name.

**Cross-links between posts.** TCM links to RentSoft and RentSoft links back to TCM, every time either is mentioned.

**Willingness to say the unflattering thing.** The rewards points history tab. Manually reposting every single listing because you never automated it. Losing the pre-paid credits battle. These land because they're specific admissions of a real decision, not generic humility.

**A dry closing beat.** TCM's ending is the strongest thing on the blog:
> *Did we become millionaires? No.*
> *Did we get thousands of users overnight? No.*
> *Did people see me on campus and say "Hey! You're the guy that built that cool tool that helped me sell my contract!"? No.*
> *... But building a site from the bottom up ... taught me more than any class ever had.*

Rhetorical questions, deadpan answers, then the turn. Worth stealing from yourself once per post, not more.

## 5. What the voice avoids

- **No hype.** Nothing is "seamless," "powerful," "game-changing," or "delightful." RentSoft ran a real business and the post never once calls it impressive.
- **No second-person advice.** You don't tell the reader what they should do. Lessons are framed as things *you* learned, not instructions.
- **No tech-stack showing off.** Stripe, Flutter, Python ETL scripts, Access database. Technology appears only when it is part of the story, and there is no "built with" section anywhere.
- **No throat-clearing.** No "In this post I'll cover..." Posts open directly on the subject.
- **No moral at the end.** "How did it go?" reports the outcome and stops. It doesn't reach for significance.

## 6. Captions

Every body image gets a `<p class="image-description">` underneath. Average 12 to 26 words. They are not neutral alt-text; they carry jokes and asides that don't fit the body:

> *"The home page displayed all items for sale (ignore the category and price filters, I never made those funcitonal)."*
> *"The Brigglist login page was the only decent looking part of the entire site. It was the most reliable part too."*
> *"The Point of Sale page where the money was made."*
> *"3:28am on launch day attempting to migrate Top Hat data into RentSoft."*

**RULE:** captions are a place for personality. A caption that just names what's in the screenshot is a wasted one.

## 7. The learnings section, precisely

The format is strict and worth preserving:

```html
<p>One-sentence lesson, stated as a claim.</p>
<ul>
    <li>Why it came up on this project, specifically.</li>
    <li>What actually happened.</li>
    <li>The wider takeaway, sometimes.</li>
</ul>
```

3 groups in TCM, 5 in RentSoft, with 2 to 4 bullets each. The lead sentences are flat declaratives, occasionally with a parenthetical hedge:

> *"Don't assume you know what users want."*
> *"Marketing an app and getting users is just as hard, if not harder, than building the app itself."*
> *"Don't start by building something complex, start simple and then build up from there (easier said than done)."*
> *"Don't forget to plan for the data migration!"*
> *"Stakeholder/Business Management is always harder than I want it to be."*

Note that they're generic-sounding *on purpose*; the specificity lives in the bullets underneath.

## 8. Polish level

The posts contain real typos: "opporutnity," "funcitonal," "convuluted," "improvments," "guage," "sripts," "upport," "phisihing," "experirence." Sentences occasionally run on. Capitalization of feature names is inconsistent.

This is not a defect to fix, and I'm not going to introduce typos on purpose. But it means **the target is "written carefully in one sitting by a person," not "edited."** If a passage reads too smooth and balanced, it's drifted out of voice. Specifically: avoid perfectly parallel three-item lists, avoid sentences that resolve too neatly, and don't be afraid of a slightly awkward clause if it's how you'd actually say it.

## 9. Formatting conventions (HTML)

- Hero image directly under the date: `<img class="img-thumbnail" src="...">`, no caption.
- Body images: `<div class="text-center"><img class="img-thumbnail blog-image" src="..."></div>` followed by `<p class="image-description">`.
- Posts end with a final image, no caption, before the contact section. (Top Hat's storefront, the Sovy coming-soon page, the app competition check.)
- External links get `target="_blank"`. Links to your own blog posts also get `target="_blank"`.
- Nav brand is the text `TF` on real posts (the `template.html` logo variant is unused).

---

## Applying this to KeepTrack: what changes

If you sign off on the above, the rewrite would:

1. Strip all 15 dash asides and convert the ones worth keeping into parentheses, semicolons, or separate sentences.
2. Cut contraction density by roughly two thirds, and lengthen sentences and paragraphs to match.
3. Decide past vs. present tense (see §1). I'd like your call on this one.
4. Push more personality into the five captions and out of the body.
5. Rework the learnings section so the lead sentences are flatter and the bullets carry the specifics.
6. Add a dry closing beat in "How did it go?". The honest "the user base is approximately me" material is the right raw ingredient.
7. Reconsider the "What's next?" section. **It has no precedent in the other three posts**, all of which end on outcome rather than plans. Options: keep it (KeepTrack is genuinely unfinished and it's the most interesting material you gave me), or fold the roadmap into "How did it go?" as a closing paragraph.
8. Give the AI tooling lesson more room. It is now the first item in the learnings section, and it may deserve a mention up top as well so it isn't a surprise 1,200 words in.
