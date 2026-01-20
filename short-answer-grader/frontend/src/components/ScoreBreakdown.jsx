import React from 'react';
import RubricBar from './RubricBar';

const ScoreBreakdown = ({ overallScore, perDimension, maxScore = 1, isOverridden = false }) => {
    const getScoreClass = (score) => {
        if (score >= 0.8) return 'score-excellent';
        if (score >= 0.6) return 'score-good';
        if (score >= 0.4) return 'score-partial';
        return 'score-needs-improvement';
    };

    const scorePercentage = (overallScore * 100).toFixed(1);
    const dimensions = Object.entries(perDimension || {});

    return (
        <div className="score-breakdown card">
            <div className={`overall-score ${getScoreClass(overallScore)}`}>
                <span className="score-label">Overall Score</span>
                <span className="score-value">
                    {scorePercentage}%
                    {isOverridden && <span className="overridden-badge"> (Overridden)</span>}
                </span>
                {maxScore !== 1 && (
                    <span className="score-percentage">
                        ({(overallScore * maxScore).toFixed(1)} / {maxScore} points)
                    </span>
                )}
            </div>

            {dimensions.length > 0 && (
                <div className="dimension-scores">
                    <h4>Score by Dimension</h4>
                    {dimensions.map(([name, data]) => (
                        <RubricBar
                            key={name}
                            name={name}
                            score={data.score}
                            confidence={data.confidence}
                            highlights={data.highlights}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

export default ScoreBreakdown;