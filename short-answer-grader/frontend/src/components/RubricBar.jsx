import React from 'react';

const RubricBar = ({ name, score, confidence, highlights = [] }) => {
    const percentage = (score * 100).toFixed(0);
    
    const getBarClass = () => {
        if (score >= 0.8) return 'bar-excellent';
        if (score >= 0.6) return 'bar-good';
        if (score >= 0.4) return 'bar-partial';
        return 'bar-needs-improvement';
    };

    return (
        <div className="rubric-bar">
            <div className="rubric-bar-header">
                <span className="dimension-name">{name}</span>
                <span className="dimension-score">
                    {percentage}%
                    {confidence !== undefined && (
                        <span className="confidence">
                            (conf: {(confidence * 100).toFixed(0)}%)
                        </span>
                    )}
                </span>
            </div>
            <div className="bar-container">
                <div 
                    className={`bar-fill ${getBarClass()}`}
                    style={{ width: `${percentage}%` }}
                />
            </div>
            {highlights && highlights.length > 0 && (
                <div className="bar-highlights">
                    <small>Evidence: {highlights.map(h => `"${h.text}"`).join(', ')}</small>
                </div>
            )}
        </div>
    );
};

export default RubricBar;