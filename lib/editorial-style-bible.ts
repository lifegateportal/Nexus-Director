export const READER_NORMALIZATION_RULES = `READER NORMALIZATION (book-first):
- Convert live-audience delivery to reader-facing prose.
- Never address a live audience anywhere in the book.
- Remove room-control cues and response prompts (e.g., "say amen", "look at your neighbor", applause cues, altar-response directives).
- Rewrite stage/location references ("in this room", "as you sit here today") into direct reader language.
- Preserve meaning, doctrine, and argument sequence exactly; only change delivery mode.`;

export const SOURCE_LOCK_RULES = `SOURCE-LOCK FIDELITY:
- Every substantive claim must be directly supported by provided transcript excerpts.
- Do not add new doctrine, stories, historical details, or applications not present in source material.
- You may improve clarity, order, and transitions only when they preserve original meaning.
- If support is weak for a sentence, simplify or remove it.`;

export const PREMIUM_BOOK_STYLE_RULES = `PREMIUM BOOK STYLE STANDARDS:

PARAGRAPH CRAFT:
- No paragraph should exceed 5 sentences. Short paragraphs (1–2 sentences) are not weakness — they are emphasis.
- Vary opening words across consecutive paragraphs. Never start two adjacent paragraphs with the same word or phrase.
- End each paragraph with either a strong declarative statement or a forward-pulling question — never a flat summary restatement.

SENTENCE RHYTHM:
- Mix sentence lengths deliberately: long sentences explain, short sentences land the blow.
- No three consecutive sentences should be the same approximate length.
- Avoid passive constructions. Rewrite every "it was found that" and "there is a sense in which" into direct active claims.

FORBIDDEN PHRASES (hard ban — delete or rewrite every instance):
"In conclusion" | "It's important to note" | "It is crucial to remember" | "Let's delve into" | "A tapestry of" | "Navigating the landscape" | "In today's fast-paced world" | "Furthermore" | "Moreover" | "It is worth noting" | "At the end of the day" | "Game-changer" | "Paradigm shift" | "Deep dive" | "Unpack" | "Moving forward" | "Robust" | "Leverage" | "Synergy" | "It goes without saying" | "The truth is," | "The fact of the matter is"

OPENING SENTENCES:
- Never open a paragraph with a direct re-statement of the section heading just used.
- Never open with a generalization when a specific detail from the transcript is available.

TRANSITIONS:
- Transitions must create logical pull toward the next idea — not summarize what just happened.
- Mid-chapter summary transitions ("So, as we have seen...", "To summarize...") are forbidden.`;

const AUDIENCE_PATTERNS = [
	/\blook at your neighbor\b/gi,
	/\bsay amen\b/gi,
	/\bclap your hands\b/gi,
	/\blift your hands\b/gi,
	/\btell them how good they look\b/gi,
	/\bas you sit here today\b/gi,
	/\bin this room today\b/gi,
	/\bright here in this place\b/gi,
	/\bthe person next to you\b/gi,
	/\byour neighbor\b/gi,
	/\bthis audience\b/gi,
];

const NON_BOOK_PATTERNS = [
	/\bgood\s+(morning|afternoon|evening),?\s+(church|everyone|family|saints)\b/gi,
	/\bwelcome\s+(to\s+church|everyone|family)\b/gi,
	/\bi\s+(just\s+)?want\s+to\s+thank\s+(you|everyone|all\s+of\s+you)\b/gi,
	/\bthank\s+you\s+(everyone|all|so\s+much|for\s+coming|for\s+joining|for\s+being\s+here)\b/gi,
	/\bwe\s+thank\s+you\s+for\s+coming\b/gi,
	/\blet\s+us\s+appreciate\b/gi,
	/\bput\s+your\s+hands\s+together\b/gi,
	/\bgive\s+the\s+lord\s+a\s+hand\b/gi,
	/\byou\s+may\s+be\s+seated\b/gi,
	/\btoday,?\s+we\s+are\s+looking\s+at\b/gi,
	/\blet\s+me\s+start\s+with\s+the\s+big\s+one\s+first\b/gi,
	/\bwell,?\s+we\s+never\s+have\s+enough\s+time\s+to\s+share\b/gi,
	/\bi\s+advance\s+in\s+love\b/gi,
];

const NON_BOOK_SENTENCE_PATTERNS = [
	/\b(that\s+hand\s+clap\s+was\s+for\s+me|let'?s\s+do\s+it\s+for\s+jesus\s+christ|what\s+a\s+mighty\s+god\s+we\s+serve)\b/i,
	/\b(father,?\s+we\s+thank\s+you|thank\s+you,?\s+holy\s+spirit|blessed\s+be\s+the\s+name\s+of\s+the\s+lord|you\s+deserve\s+all\s+glory|you\s+deserve\s+all\s+adoration|we\s+bless\s+your\s+holy\s+name|great\s+is\s+your\s+faithfulness)\b/i,
	/\b(the\s+spirit\s+of\s+god\s+was\s+ministering\s+to\s+me|god\s+is\s+healing\s+you\s+today|that\s+issue\s+will\s+not\s+repeat\s+itself|he'?s\s+touching\s+you)\b/i,
	/\b(some\s+of\s+you\b|someone\s+here\b|the\s+lord\s+is\s+touching\s+someone\b)\b/i,
];

const RECAP_CUE_RE = /\b(this\s+month'?s\s+theme|our\s+monthly\s+theme|series\s+theme|theme\s+for\s+the\s+month|as\s+i\s+said\s+last\s+(week|message|time)|from\s+our\s+last\s+message|in\s+the\s+previous\s+message|continuing\s+this\s+series|part\s+\d+\s+of\s+this\s+series|welcome\s+back\s+to\s+this\s+series)\b/i;

export const NON_BOOK_CUE_RE = /\b(say amen|look at your neighbor|clap your hands|lift your hands|as you sit here today|in this room today|right here in this place|the person next to you|your neighbor|this audience|good\s+(morning|afternoon|evening),?\s+(church|everyone|family|saints)|welcome\s+(to\s+church|everyone|family)|i\s+(just\s+)?want\s+to\s+thank\s+(you|everyone|all\s+of\s+you)|thank\s+you\s+(everyone|all|so\s+much|for\s+coming|for\s+joining|for\s+being\s+here)|let\s+us\s+appreciate|put\s+your\s+hands\s+together|give\s+the\s+lord\s+a\s+hand|you\s+may\s+be\s+seated|that\s+hand\s+clap\s+was\s+for\s+me|let'?s\s+do\s+it\s+for\s+jesus\s+christ|what\s+a\s+mighty\s+god\s+we\s+serve|father,?\s+we\s+thank\s+you|thank\s+you,?\s+holy\s+spirit|blessed\s+be\s+the\s+name\s+of\s+the\s+lord|you\s+deserve\s+all\s+glory|you\s+deserve\s+all\s+adoration|we\s+bless\s+your\s+holy\s+name|great\s+is\s+your\s+faithfulness|the\s+spirit\s+of\s+god\s+was\s+ministering\s+to\s+me|god\s+is\s+healing\s+you\s+today|that\s+issue\s+will\s+not\s+repeat\s+itself|he'?s\s+touching\s+you|some\s+of\s+you|someone\s+here|today,?\s+we\s+are\s+looking\s+at|well,?\s+we\s+never\s+have\s+enough\s+time\s+to\s+share|i\s+advance\s+in\s+love)\b/gi;

function cleanBookText(input: string): string {
	return input
		.replace(/\b(Amen|hallelujah|praise the lord|my god)\b/gi, "")
		.replace(/\s{2,}/g, " ")
		.replace(/\n{3,}/g, "\n\n")
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n[ \t]+/g, "\n")
		.trim();
}

function pruneNonBookSentences(input: string): string {
	const parts = input
		.split(/(?<=[.!?])\s+|\n+/)
		.map((part) => part.trim())
		.filter(Boolean);

	const kept = parts.filter((part) => !NON_BOOK_SENTENCE_PATTERNS.some((pattern) => pattern.test(part)));
	return cleanBookText(kept.join(" "));
}

function normalizeForRecapMatch(input: string): string[] {
	return input
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, " ")
		.split(/\s+/)
		.filter((token) => token.length > 2);
}

function jaccardSimilarity(a: string[], b: string[]): number {
	if (a.length === 0 || b.length === 0) return 0;
	const aSet = new Set(a);
	const bSet = new Set(b);
	let intersection = 0;
	for (const token of aSet) {
		if (bSet.has(token)) intersection += 1;
	}
	const union = aSet.size + bSet.size - intersection;
	return union > 0 ? intersection / union : 0;
}

export function pruneRedundantSeriesRecaps(input: string): string {
	const sentences = input
		.split(/(?<=[.!?])\s+|\n+/)
		.map((sentence) => sentence.trim())
		.filter(Boolean);

	const kept: string[] = [];
	const recapSignatures: string[][] = [];

	for (const sentence of sentences) {
		if (!RECAP_CUE_RE.test(sentence)) {
			kept.push(sentence);
			continue;
		}
		const signature = normalizeForRecapMatch(sentence);
		const isDuplicate = recapSignatures.some((existing) => jaccardSimilarity(existing, signature) >= 0.7);
		if (!isDuplicate) {
			recapSignatures.push(signature);
			kept.push(sentence);
		}
	}

	return cleanBookText(kept.join(" "));
}

export function stripNonBookLanguage(input: string): string {
	let output = pruneNonBookSentences(input);
	for (const pattern of AUDIENCE_PATTERNS) {
		output = output.replace(pattern, "");
	}
	for (const pattern of NON_BOOK_PATTERNS) {
		output = output.replace(pattern, "");
	}
	return pruneNonBookSentences(pruneRedundantSeriesRecaps(cleanBookText(output)));
}

export function stripAudienceLanguage(input: string): string {
	return stripNonBookLanguage(input);
}

type HarmonizeManifestInput = {
	frontMatter: {
		preface: string;
		introduction: string;
		conclusion: string;
		aboutAuthor: string | null;
		resourcesList: string[];
	};
	chapters: Array<{
		number: number;
		title: string;
		intro: string;
		conclusion: string;
		keyTakeaways: string[];
		reflectionQuestions: string[];
		totalWordCount: number;
		sections: Array<{
			body: string;
			wordCount: number;
		}>;
	}>;
};

function countWords(text: string): number {
	return text.trim().split(/\s+/).filter(Boolean).length;
}

export function harmonizeBookManifest<T extends HarmonizeManifestInput>(manifest: T): T {
	const chapters = manifest.chapters.map((chapter) => {
		const sections = chapter.sections.map((section) => {
			const body = stripNonBookLanguage(section.body ?? "");
			return {
				...section,
				body,
				wordCount: countWords(body),
			};
		});

		const intro = stripNonBookLanguage(chapter.intro ?? "");
		const conclusion = stripNonBookLanguage(chapter.conclusion ?? "");
		const keyTakeaways = (chapter.keyTakeaways ?? [])
			.map((item) => stripNonBookLanguage(item))
			.filter(Boolean);
		const reflectionQuestions = (chapter.reflectionQuestions ?? [])
			.map((item) => stripNonBookLanguage(item))
			.filter(Boolean);

		const totalWordCount =
			sections.reduce((sum, section) => sum + section.wordCount, 0) +
			countWords([intro, conclusion, ...keyTakeaways, ...reflectionQuestions].join(" "));

		return {
			...chapter,
			intro,
			conclusion,
			sections,
			keyTakeaways,
			reflectionQuestions,
			totalWordCount,
		};
	});

	const frontMatter = {
		...manifest.frontMatter,
		preface: stripNonBookLanguage(manifest.frontMatter.preface ?? ""),
		introduction: stripNonBookLanguage(manifest.frontMatter.introduction ?? ""),
		conclusion: stripNonBookLanguage(manifest.frontMatter.conclusion ?? ""),
		aboutAuthor: manifest.frontMatter.aboutAuthor ? stripNonBookLanguage(manifest.frontMatter.aboutAuthor) : null,
		resourcesList: (manifest.frontMatter.resourcesList ?? []).map((item) => stripNonBookLanguage(item)).filter(Boolean),
	};

	return {
		...manifest,
		frontMatter,
		chapters,
	};
}
