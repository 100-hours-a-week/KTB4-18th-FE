import type { ReactNode } from 'react';

const INLINE_MARKDOWN_PATTERN =
  /(\*\*.+?\*\*|__.+?__|~~.+?~~|`[^`]+`|\*[^*]+\*|_[^_]+_|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g;

function renderInlineMarkdown(value: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let previous = 0;
  let key = 0;
  for (const match of value.matchAll(INLINE_MARKDOWN_PATTERN)) {
    const token = match[0];
    const start = match.index ?? 0;
    if (start > previous) nodes.push(value.slice(previous, start));
    if (token.startsWith('**') || token.startsWith('__')) {
      nodes.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('~~')) {
      nodes.push(<del key={key++}>{token.slice(2, -2)}</del>);
    } else if (token.startsWith('`')) {
      nodes.push(<code key={key++}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith('*') || token.startsWith('_')) {
      nodes.push(<em key={key++}>{token.slice(1, -1)}</em>);
    } else {
      const link = token.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
      if (link) {
        nodes.push(
          <a key={key++} href={link[2]} target="_blank" rel="noreferrer">
            {link[1]}
          </a>,
        );
      } else {
        nodes.push(token);
      }
    }
    previous = start + token.length;
  }
  if (previous < value.length) nodes.push(value.slice(previous));
  return nodes;
}

function splitMarkdownTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.replace(/\\\|/g, '|').trim());
}

function isMarkdownTableSeparator(line: string): boolean {
  const cells = splitMarkdownTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isMarkdownBlockStart(lines: string[], index: number): boolean {
  const line = lines[index]?.trim() ?? '';
  return (
    /^#{1,6}\s/.test(line) ||
    /^```/.test(line) ||
    /^>/.test(line) ||
    /^[-*+]\s+/.test(line) ||
    /^\d+[.)]\s+/.test(line) ||
    /^(?:---+|___+|\*\*\*+)$/.test(line) ||
    (line.includes('|') && isMarkdownTableSeparator(lines[index + 1] ?? ''))
  );
}

export function TermsMarkdown({ content }: { content: string }) {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) {
      index += 1;
      continue;
    }
    if (/^```/.test(line)) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*```/.test(lines[index])) code.push(lines[index++]);
      if (index < lines.length) index += 1;
      blocks.push(
        <pre key={`code-${index}`}>
          <code>{code.join('\n')}</code>
        </pre>,
      );
      continue;
    }
    if (/^#{1,6}\s/.test(line)) {
      const heading = line.match(/^(#{1,6})\s+(.*)$/);
      const level = Math.min(6, heading?.[1].length ?? 2);
      const headingTags = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;
      const Tag = headingTags[level - 1];
      blocks.push(<Tag key={`heading-${index}`}>{renderInlineMarkdown(heading?.[2] ?? '')}</Tag>);
      index += 1;
      continue;
    }
    if (line.includes('|') && isMarkdownTableSeparator(lines[index + 1] ?? '')) {
      const headers = splitMarkdownTableRow(line);
      const separators = splitMarkdownTableRow(lines[index + 1]);
      const alignments = separators.map((cell) =>
        cell.startsWith(':') && cell.endsWith(':')
          ? 'center'
          : cell.endsWith(':')
            ? 'right'
            : 'left',
      );
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].trim().includes('|')) {
        rows.push(splitMarkdownTableRow(lines[index++]));
      }
      blocks.push(
        <div className="mypage-terms-table-scroll" key={`table-${index}`}>
          <table className="mypage-terms-table">
            <thead>
              <tr>
                {headers.map((cell, column) => (
                  <th
                    key={`heading-${column}`}
                    style={{ textAlign: alignments[column] as 'left' | 'center' | 'right' }}
                  >
                    {renderInlineMarkdown(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={`row-${rowIndex}`}>
                  {headers.map((_, column) => (
                    <td
                      key={`cell-${column}`}
                      style={{ textAlign: alignments[column] as 'left' | 'center' | 'right' }}
                    >
                      {renderInlineMarkdown(row[column] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^[-*+]\s+/.test(line) || /^\d+[.)]\s+/.test(line)) {
      const ordered = /^\d+[.)]\s+/.test(line);
      const listItems: ReactNode[] = [];
      const pattern = ordered ? /^\d+[.)]\s+(.*)$/ : /^[-*+]\s+(.*)$/;
      while (index < lines.length && pattern.test(lines[index].trim())) {
        const item = lines[index].trim().replace(pattern, '$1');
        listItems.push(<li key={index}>{renderInlineMarkdown(item)}</li>);
        index += 1;
      }
      blocks.push(
        ordered ? (
          <ol key={`list-${index}`}>{listItems}</ol>
        ) : (
          <ul key={`list-${index}`}>{listItems}</ul>
        ),
      );
      continue;
    }
    if (/^>/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) {
        quote.push(lines[index++].replace(/^\s*>\s?/, '').trim());
      }
      blocks.push(
        <blockquote key={`quote-${index}`}>{renderInlineMarkdown(quote.join(' '))}</blockquote>,
      );
      continue;
    }
    if (/^(?:---+|___+|\*\*\*+)$/.test(line)) {
      blocks.push(<hr key={`rule-${index}`} />);
      index += 1;
      continue;
    }
    const paragraph = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isMarkdownBlockStart(lines, index)) {
      paragraph.push(lines[index++].trim());
    }
    blocks.push(<p key={`paragraph-${index}`}>{renderInlineMarkdown(paragraph.join(' '))}</p>);
  }
  return <div className="mypage-terms-markdown">{blocks}</div>;
}
