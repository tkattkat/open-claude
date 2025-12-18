import { marked } from 'marked';
import hljs from 'highlight.js';

export interface Citation {
  url?: string;
  title?: string;
  start_index?: number;
  end_index?: number;
}

// Configure marked with syntax highlighting
marked.setOptions({
  breaks: true,
  gfm: true,
});

// Custom renderer for code blocks with syntax highlighting and copy button
const renderer = new marked.Renderer();
renderer.code = function ({ text, lang }: { text: string; lang?: string }) {
  const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext';
  const highlighted = hljs.highlight(text, { language }).value;
  // Encode the raw text for the data attribute (escape HTML entities)
  const encodedText = text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<div class="code-block-wrapper">
    <button class="code-copy-btn" data-code="${encodedText}" title="Copy code">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
      </svg>
    </button>
    <pre><code class="hljs language-${language}">${highlighted}</code></pre>
  </div>`;
};

marked.use({ renderer });

export function parseMarkdown(t: string, citations?: Citation[]): string {
  if (!t) return '';

  let text = t;

  // Apply citations if present (before markdown parsing)
  if (citations && citations.length > 0) {
    // Sort citations by start_index descending to avoid index shifting
    const sortedCitations = [...citations].sort((a, b) => (b.start_index || 0) - (a.start_index || 0));
    for (const cit of sortedCitations) {
      if (cit.start_index !== undefined && cit.end_index !== undefined) {
        const before = text.slice(0, cit.start_index);
        const cited = text.slice(cit.start_index, cit.end_index);
        const after = text.slice(cit.end_index);
        const citNumber = citations.indexOf(cit) + 1;
        // Use HTML directly for citations since marked will preserve it
        const escapedUrl = (cit.url || '').replace(/"/g, '&quot;');
        const escapedTitle = (cit.title || '').replace(/"/g, '&quot;');
        text = before + `<a class="citation-link" href="${escapedUrl}" target="_blank" title="${escapedTitle}">${cited}</a><sup class="citation-num">[${citNumber}]</sup>` + after;
      }
    }
  }

  return marked.parse(text) as string;
}
