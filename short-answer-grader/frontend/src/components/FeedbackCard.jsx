import React from 'react';

const FeedbackCard = ({ feedback = [], perDimension = {} }) => {
    const dimensions = Object.entries(perDimension);

    const getScoreBadgeClass = (score) => {
        if (score >= 0.8) return 'badge-excellent';
        if (score >= 0.6) return 'badge-good';
        if (score >= 0.4) return 'badge-partial';
        return 'badge-needs-improvement';
    };

    const getScoreLabel = (score) => {
        if (score >= 0.8) return 'Excellent';
        if (score >= 0.6) return 'Good';
        if (score >= 0.4) return 'Partial';
        return 'Needs Work';
    };

    return (
        <div className="feedback-card card">
            <h3>Feedback & Analysis</h3>

            {/* General Feedback */}
            {feedback && feedback.length > 0 && (
                <div className="general-feedback">
                    <h4>Summary</h4>
                    <ul className="feedback-list">
                        {feedback.map((item, index) => (
                            <li key={index} className="feedback-item">
                                {item}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Per-Dimension Feedback */}
            {dimensions.length > 0 && (
                <div className="dimension-feedback">
                    <h4>Detailed Analysis by Criterion</h4>
                    {dimensions.map(([name, data]) => (
                        <div key={name} className="dimension-detail">
                            <div className="dimension-header">
                                <strong>{name}</strong>
                                <span className={`score-badge ${getScoreBadgeClass(data.score)}`}>
                                    {getScoreLabel(data.score)} ({(data.score * 100).toFixed(0)}%)
                                </span>
                            </div>

                            {data.highlights && data.highlights.length > 0 && (
                                <div className="evidence">
                                    <span className="evidence-label">Evidence found:</span>
                                    {data.highlights.map((h, i) => (
                                        <span key={i} className="evidence-span">
                                            "{h.text}"
                                        </span>
                                    ))}
                                </div>
                            )}

                            {(!data.highlights || data.highlights.length === 0) && data.score < 0.5 && (
                                <div className="missing-evidence">
                                    <span className="missing-label">
                                        ⚠️ Limited evidence found for this criterion
                                    </span>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {feedback.length === 0 && dimensions.length === 0 && (
                <p className="no-feedback">No detailed feedback available for this submission.</p>
            )}
        </div>
    );
};

export default FeedbackCard;