import { sensitiveMarkdown } from "../src/lib/sensitiveDocs";

// Prints the generated tables of docs/SENSITIVE_DATA.md. Paste the output over the block between the BEGIN and END markers.
console.log(sensitiveMarkdown());
