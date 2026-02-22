/**
 * @typedef {Object} DebugFrame
 * @property {string}   raw
 * @property {string}   chunk
 * @property {boolean}  inString
 * @property {string[]} stack
 * @property {Array<{label: string, appended: string}>} steps
 * @property {string}   completed
 * @property {boolean}  partialKey
 * @property {any}      parsed
 */

export async function* jsonReader(reader) {
	for await (const frame of jsonReaderDebug(reader)) {
		yield frame.parsed;
	}
}

export async function* jsonReaderDebug(reader) {
	const decoder = new TextDecoder();
	let raw = "";

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;

		const chunk =
			typeof value === "string"
				? value
				: decoder.decode(value, { stream: true });
		raw += chunk;

		const frame = tryParse(raw, chunk);
		if (frame) yield frame;
	}

	const frame = tryParse(raw, "");
	if (frame) yield frame;
}

function tryParse(raw, chunk) {
	const debug = autoClose(raw);
	if (!debug) return null;

	try {
		return { raw, chunk, ...debug, parsed: JSON.parse(debug.completed) };
	} catch {
		return null;
	}
}

const BARE_KEY_RE = /[{,]\s*"[^"]*"\s*$/;

function autoClose(raw) {
	if (raw.trimStart().length === 0) return null;

	const { inString, stack } = scan(raw);
	const steps = [];
	let result = raw;
	let partialKey = false;

	const insideObject = stack.length > 0 && stack[stack.length - 1] === "{";

	if (inString) {
		result += '"';
		steps.push({ label: "Close open string", appended: '"' });

		if (insideObject && BARE_KEY_RE.test(result)) {
			result = result
				.replace(/,\s*"[^"]*"\s*$/, "")
				.replace(/\{\s*"[^"]*"\s*$/, "{");
			steps.push({ label: "Strip incomplete key", appended: "(removed)" });
			partialKey = true;
		}
	}

	if (/:\s*$/.test(result)) {
		result = result.replace(/:\s*$/, ": null");
		steps.push({ label: "Insert null for missing value", appended: "null" });
	} else if (/,\s*$/.test(result)) {
		result = result.replace(/,\s*$/, "");
		steps.push({ label: "Strip trailing comma", appended: "(removed)" });
	}

	if (!partialKey && insideObject && BARE_KEY_RE.test(result)) {
		result += ": null";
		steps.push({ label: "Add null for bare key", appended: ": null" });
	}

	if (stack.length > 0) {
		const closers = stack
			.map((s) => (s === "{" ? "}" : "]"))
			.reverse()
			.join("");
		result += closers;
		steps.push({ label: "Close open containers", appended: closers });
	}

	return { inString, stack: [...stack], steps, completed: result, partialKey };
}

function scan(raw) {
	let inString = false;
	let escaped = false;
	const stack = [];

	for (let i = 0; i < raw.length; i++) {
		const ch = raw[i];

		if (escaped) {
			escaped = false;
			continue;
		}
		if (ch === "\\" && inString) {
			escaped = true;
			continue;
		}
		if (ch === '"') {
			inString = !inString;
			continue;
		}
		if (inString) continue;

		if (ch === "{" || ch === "[") stack.push(ch);
		else if (ch === "}" || ch === "]") stack.pop();
	}

	return { inString, stack };
}
