import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { questionsAPI } from '../api';

const CreateQuestion = () => {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    
    const [formData, setFormData] = useState({
        title: '',
        content: '',
        referenceAnswer: '',
        maxScore: 100,
        subject: '',
        topic: '',
        difficulty: 'medium',
        autoGenerateRubric: true
    });

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormData({
            ...formData,
            [name]: type === 'checkbox' ? checked : value
        });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            await questionsAPI.create(formData);
            navigate('/teacher');
        } catch (err) {
            setError(err.response?.data?.message || 'Failed to create question');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="create-question-page">
            <h1>Create New Question</h1>

            {error && <div className="alert alert-error">{error}</div>}

            <form onSubmit={handleSubmit} className="question-form">
                <div className="form-group">
                    <label htmlFor="title">Question Title *</label>
                    <input
                        type="text"
                        id="title"
                        name="title"
                        value={formData.title}
                        onChange={handleChange}
                        required
                        placeholder="e.g., Explain the concept of neural networks"
                    />
                </div>

                <div className="form-group">
                    <label htmlFor="content">Question Content *</label>
                    <textarea
                        id="content"
                        name="content"
                        value={formData.content}
                        onChange={handleChange}
                        required
                        rows={4}
                        placeholder="Full question text that students will see"
                    />
                </div>

                <div className="form-group">
                    <label htmlFor="referenceAnswer">Reference Answer *</label>
                    <textarea
                        id="referenceAnswer"
                        name="referenceAnswer"
                        value={formData.referenceAnswer}
                        onChange={handleChange}
                        required
                        rows={6}
                        placeholder="Model answer with key points separated by periods or semicolons"
                    />
                    <small>
                        Tip: Structure your answer with clear points. Each sentence or semicolon-separated 
                        phrase will be used as a rubric criterion for auto-grading.
                    </small>
                </div>

                <div className="form-row">
                    <div className="form-group">
                        <label htmlFor="maxScore">Max Score</label>
                        <input
                            type="number"
                            id="maxScore"
                            name="maxScore"
                            value={formData.maxScore}
                            onChange={handleChange}
                            min={1}
                        />
                    </div>

                    <div className="form-group">
                        <label htmlFor="difficulty">Difficulty</label>
                        <select
                            id="difficulty"
                            name="difficulty"
                            value={formData.difficulty}
                            onChange={handleChange}
                        >
                            <option value="easy">Easy</option>
                            <option value="medium">Medium</option>
                            <option value="hard">Hard</option>
                        </select>
                    </div>
                </div>

                <div className="form-row">
                    <div className="form-group">
                        <label htmlFor="subject">Subject</label>
                        <input
                            type="text"
                            id="subject"
                            name="subject"
                            value={formData.subject}
                            onChange={handleChange}
                            placeholder="e.g., Computer Science"
                        />
                    </div>

                    <div className="form-group">
                        <label htmlFor="topic">Topic</label>
                        <input
                            type="text"
                            id="topic"
                            name="topic"
                            value={formData.topic}
                            onChange={handleChange}
                            placeholder="e.g., Deep Learning"
                        />
                    </div>
                </div>

                <div className="form-group checkbox-group">
                    <label>
                        <input
                            type="checkbox"
                            name="autoGenerateRubric"
                            checked={formData.autoGenerateRubric}
                            onChange={handleChange}
                        />
                        Auto-generate rubric from reference answer
                    </label>
                </div>

                <div className="form-actions">
                    <button 
                        type="button" 
                        onClick={() => navigate('/teacher')}
                        className="btn btn-secondary"
                    >
                        Cancel
                    </button>
                    <button 
                        type="submit" 
                        className="btn btn-primary"
                        disabled={loading}
                    >
                        {loading ? 'Creating...' : 'Create Question'}
                    </button>
                </div>
            </form>
        </div>
    );
};

export default CreateQuestion;