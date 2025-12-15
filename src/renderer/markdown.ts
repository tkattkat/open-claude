import { marked, Renderer } from 'marked';
import hljs from 'highlight.js';

export interface Citation {
  url?: string;
  title?: string;
  start_index?: number;
  end_index?: number;
}

// Create custom renderer with syntax highlighting
const renderer = new Renderer();

renderer.code = ({ text, lang }: { text: string; lang?: string }) => {
  const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext';
  let highlighted: string;

  try {
    highlighted = hljs.highlight(text, { language }).value;
  } catch {
    highlighted = hljs.highlightAuto(text).value;
  }

  const langLabel = lang ? `<span class="code-lang">${lang}</span>` : '';
  const copyBtn = `<button class="code-copy-btn" onclick="navigator.clipboard.writeText(this.parentElement.querySelector('code').textContent);this.textContent='Copied!';setTimeout(()=>this.textContent='Copy',1500)">Copy</button>`;

  return `<div class="code-block-wrapper"><div class="code-block-header">${langLabel}${copyBtn}</div><pre><code class="hljs language-${language}">${highlighted}</code></pre></div>`;
};

// Configure marked with custom renderer
marked.setOptions({
  breaks: true,
  gfm: true,
  renderer,
});

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
