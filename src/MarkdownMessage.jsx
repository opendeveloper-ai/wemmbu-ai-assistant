import React from 'react';

function safeHref(value) {
  try {
    const parsed = new URL(value, window.location.origin);
    return ['http:', 'https:', 'mailto:'].includes(parsed.protocol) ? parsed.href : null;
  } catch { return null; }
}

function Inline({ text }) {
  const source = String(text ?? '');
  const tokenPattern = /(\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|`[^`]+`|\*[^*\n]+\*|_[^_\n]+_|!?\[[^\]]*\]\([^\s)]+(?:\s+"[^"]*")?\))/g;
  const parts = source.split(tokenPattern).filter((part) => part !== '');
  return parts.map((part, index) => {
    if ((part.startsWith('**') && part.endsWith('**')) || (part.startsWith('__') && part.endsWith('__'))) return <strong key={index}><Inline text={part.slice(2, -2)} /></strong>;
    if (part.startsWith('~~') && part.endsWith('~~')) return <del key={index}><Inline text={part.slice(2, -2)} /></del>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index} className="markdown-inline-code">{part.slice(1, -1)}</code>;
    if ((part.startsWith('*') && part.endsWith('*')) || (part.startsWith('_') && part.endsWith('_'))) return <em key={index}><Inline text={part.slice(1, -1)} /></em>;
    const link = part.match(/^(!?)\[([^\]]*)\]\(([^\s)]+)(?:\s+"([^"]*)")?\)$/);
    if (link) {
      const href = safeHref(link[3]);
      if (!href) return <span key={index}>{link[2]}</span>;
      if (link[1] === '!') return <a key={index} href={href} target="_blank" rel="noreferrer" className="markdown-image-link">{link[2] || 'Open image'}</a>;
      return <a key={index} href={href} target={href.startsWith('mailto:') ? undefined : '_blank'} rel="noreferrer" title={link[4] || undefined}>{link[2]}</a>;
    }
    return <React.Fragment key={index}>{part}</React.Fragment>;
  });
}

function isRule(line) { return /^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line); }
function isList(line) { return /^(\s*)([-+*]|\d+[.)])\s+(.+)$/.exec(line); }
function splitTableRow(line) { return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim()); }
function isTableSeparator(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function parseList(lines, start, baseIndent) {
  const first = isList(lines[start]);
  const ordered = Boolean(first && /^\d/.test(first[2]));
  const Tag = ordered ? 'ol' : 'ul';
  const items = [];
  let index = start;
  while (index < lines.length) {
    const match = isList(lines[index]);
    if (!match) break;
    const indent = match[1].replace(/\t/g, '  ').length;
    if (indent < baseIndent) break;
    if (indent > baseIndent) {
      if (!items.length) break;
      const nested = parseList(lines, index, indent);
      items[items.length - 1].nested.push(nested.node);
      index = nested.next;
      continue;
    }
    const currentOrdered = /^\d/.test(match[2]);
    if (currentOrdered !== ordered && items.length) break;
    items.push({ text: match[3], nested: [] });
    index += 1;
  }
  return {
    next: index,
    node: <Tag key={`list-${start}`} className="markdown-list">{items.map((item, i) => <li key={i}><Inline text={item.text} />{item.nested}</li>)}</Tag>
  };
}

function parseBlocks(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i += 1; continue; }
    const fence = line.match(/^\s*```([\w+-]*)\s*$/);
    if (fence) {
      const language = fence[1];
      i += 1;
      const codeLines = [];
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) codeLines.push(lines[i++]);
      if (i < lines.length) i += 1;
      blocks.push(<pre className="markdown-code-block" key={`code-${i}`}><code data-language={language || undefined}>{codeLines.join('\n')}</code></pre>);
      continue;
    }
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const level = heading[1].length;
      const content = <Inline text={heading[2]} />;
      const key = `heading-${i}`;
      const props = { key, className: `markdown-heading markdown-h${level}` };
      blocks.push(level === 1 ? <h1 {...props}>{content}</h1> : level === 2 ? <h2 {...props}>{content}</h2> : level === 3 ? <h3 {...props}>{content}</h3> : level === 4 ? <h4 {...props}>{content}</h4> : level === 5 ? <h5 {...props}>{content}</h5> : <h6 {...props}>{content}</h6>);
      i += 1;
      continue;
    }
    if (isRule(line)) { blocks.push(<hr className="markdown-rule" key={`hr-${i++}`} />); continue; }
    if (/^\s*>/.test(line)) {
      const quoted = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) quoted.push(lines[i++].replace(/^\s*>\s?/, ''));
      blocks.push(<blockquote className="markdown-quote" key={`quote-${i}`}>{parseBlocks(quoted.join('\n'))}</blockquote>);
      continue;
    }
    if (i + 1 < lines.length && line.includes('|') && isTableSeparator(lines[i + 1])) {
      const headers = splitTableRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(splitTableRow(lines[i++]));
      blocks.push(<div className="markdown-table-wrap" key={`table-${i}`}><table className="markdown-table"><thead><tr>{headers.map((cell, ci) => <th key={ci}><Inline text={cell} /></th>)}</tr></thead><tbody>{rows.map((row, ri) => <tr key={ri}>{headers.map((_, ci) => <td key={ci}><Inline text={row[ci] || ''} /></td>)}</tr>)}</tbody></table></div>);
      continue;
    }
    const listMatch = isList(line);
    if (listMatch) {
      const parsed = parseList(lines, i, listMatch[1].replace(/\t/g, '  ').length);
      blocks.push(parsed.node);
      i = Math.max(parsed.next, i + 1);
      continue;
    }
    const paragraph = [line.trim()];
    i += 1;
    while (i < lines.length && lines[i].trim() && !/^\s*(?:#{1,6}\s|```|>|[-+*]\s+|\d+[.)]\s+)/.test(lines[i]) && !isRule(lines[i]) && !(i + 1 < lines.length && lines[i].includes('|') && isTableSeparator(lines[i + 1]))) paragraph.push(lines[i++].trim());
    blocks.push(<p className="markdown-paragraph" key={`p-${i}`}>{paragraph.map((part, pi) => <React.Fragment key={pi}>{pi > 0 && ' '}<Inline text={part} /></React.Fragment>)}</p>);
  }
  return blocks;
}

export default function MarkdownMessage({ text }) {
  return <div className="markdown-message">{parseBlocks(text)}</div>;
}
