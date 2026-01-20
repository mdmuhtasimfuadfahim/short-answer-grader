import React from 'react';

const HighlightedText = ({ text, highlights = [] }) => {
    if (!text) return null;
    
    if (!highlights || highlights.length === 0) {
        return <span>{text}</span>;
    }

    // Sort highlights by char_start position
    const sortedHighlights = [...highlights]
        .filter(h => h.char_start !== undefined && h.char_end !== undefined)
        .sort((a, b) => a.char_start - b.char_start);

    if (sortedHighlights.length === 0) {
        // No positional highlights, just show text with keyword highlights
        let result = text;
        highlights.forEach(h => {
            if (h.text) {
                const regex = new RegExp(`(${escapeRegex(h.text)})`, 'gi');
                result = result.replace(regex, `<mark class="highlight highlight-${h.type || 'positive'}">$1</mark>`);
            }
        });
        return <span dangerouslySetInnerHTML={{ __html: result }} />;
    }

    // Build segments with positional highlights
    const segments = [];
    let lastEnd = 0;

    sortedHighlights.forEach((highlight, index) => {
        // Add text before this highlight
        if (highlight.char_start > lastEnd) {
            segments.push({
                type: 'normal',
                text: text.slice(lastEnd, highlight.char_start)
            });
        }

        // Add highlighted text
        segments.push({
            type: 'highlight',
            text: text.slice(highlight.char_start, highlight.char_end),
            highlightType: highlight.type || 'positive',
            dimension: highlight.dimension,
            score: highlight.score
        });

        lastEnd = highlight.char_end;
    });

    // Add remaining text
    if (lastEnd < text.length) {
        segments.push({
            type: 'normal',
            text: text.slice(lastEnd)
        });
    }

    return (
        <span>
            {segments.map((segment, index) => {
                if (segment.type === 'highlight') {
                    return (
                        <mark
                            key={index}
                            className={`highlight highlight-${segment.highlightType}`}
                            title={segment.dimension ? `${segment.dimension}: ${(segment.score * 100).toFixed(0)}%` : undefined}
                        >
                            {segment.text}
                        </mark>
                    );
                }
                return <span key={index}>{segment.text}</span>;
            })}
        </span>
    );
};

// Helper to escape regex special characters
function escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export default HighlightedText;