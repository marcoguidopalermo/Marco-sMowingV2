import React from 'react';

// Renders a plain SOP string with clickable links. Supports markdown-style
// [label](url) AND bare URLs. ONLY http/https are linkified (the regex can't
// match javascript:/data:/etc, so those render as inert plain text). No data
// model change — the SOP stays a plain string; this is display-only.
const LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<]+)/g;

function linkify(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  LINK_RE.lastIndex = 0;
  while ((m = LINK_RE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const cls = 'text-indigo-600 underline break-words hover:text-indigo-800';
    if (m[1] && m[2]) {
      // markdown [label](url) — url already validated http/https by the regex
      out.push(<a key={key++} href={m[2]} target="_blank" rel="noopener noreferrer" className={cls}>{m[1]}</a>);
    } else if (m[3]) {
      // bare url — trim trailing sentence punctuation out of the href
      let url = m[3];
      let tail = '';
      const trail = url.match(/[.,;:!?)\]}'"]+$/);
      if (trail) { tail = trail[0]; url = url.slice(0, url.length - tail.length); }
      out.push(<a key={key++} href={url} target="_blank" rel="noopener noreferrer" className={cls}>{url}</a>);
      if (tail) out.push(tail);
    }
    last = LINK_RE.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export default function SopText({ text, className }: { text: string; className?: string }) {
  return <div className={`whitespace-pre-wrap ${className || ''}`}>{linkify(text || '')}</div>;
}
