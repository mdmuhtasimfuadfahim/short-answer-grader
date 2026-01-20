/**
 * ML Service client for communication with Python microservice
 */
const axios = require('axios');

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8001';

// Create axios instance with defaults
const mlClient = axios.create({
    baseURL: ML_SERVICE_URL,
    timeout: 30000, // 30 seconds
    headers: {
        'Content-Type': 'application/json'
    }
});

/**
 * Check ML service health
 */
const checkHealth = async () => {
    try {
        const response = await mlClient.get('/health');
        return {
            healthy: true,
            ...response.data
        };
    } catch (error) {
        return {
            healthy: false,
            error: error.message
        };
    }
};

/**
 * Get available models
 */
const getModels = async () => {
    const response = await mlClient.get('/models');
    return response.data;
};

/**
 * Generate text embedding
 */
const embed = async (text, model = null) => {
    const response = await mlClient.post('/embed', {
        text,
        model
    });
    return response.data;
};

/**
 * Grade a student answer
 * @param {Object} params - Grading parameters
 * @param {string} params.questionId - Question identifier
 * @param {string} params.studentId - Student identifier
 * @param {string} params.answerText - Student's answer
 * @param {Array} params.rubricDims - Array of {name, text, weight}
 * @param {string} params.referenceAnswer - Reference answer (optional)
 * @param {boolean} params.computeExplanations - Whether to compute explanations
 */
const grade = async ({
    questionId,
    studentId,
    answerText,
    rubricDims = null,
    referenceAnswer = null,
    computeExplanations = true
}) => {
    const payload = {
        question_id: questionId,
        student_id: studentId,
        answer_text: answerText,
        compute_explanations: computeExplanations
    };
    
    if (rubricDims && rubricDims.length > 0) {
        payload.rubric_dims = rubricDims.map(dim => ({
            name: dim.name,
            text: dim.text || dim.description,
            weight: dim.weight || 1.0
        }));
    } else if (referenceAnswer) {
        payload.reference_answer = referenceAnswer;
    }
    
    const response = await mlClient.post('/grade', payload);
    return response.data;
};

/**
 * Batch grade multiple answers
 */
const batchGrade = async (answers, rubricDims) => {
    const response = await mlClient.post('/grade/batch', {
        answers,
        rubric_dims: rubricDims.map(dim => ({
            name: dim.name,
            text: dim.text || dim.description,
            weight: dim.weight || 1.0
        }))
    });
    return response.data;
};

/**
 * Retry wrapper for ML service calls
 */
const withRetry = async (fn, maxRetries = 3, delay = 1000) => {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            
            if (error.response?.status >= 400 && error.response?.status < 500) {
                // Client error, don't retry
                throw error;
            }
            
            if (attempt < maxRetries) {
                console.log(`ML service call failed, retrying (${attempt}/${maxRetries})...`);
                await new Promise(resolve => setTimeout(resolve, delay * attempt));
            }
        }
    }
    
    throw lastError;
};

/**
 * Split reference answer into rubric dimensions
 * @param {string} referenceAnswer - Reference answer text
 * @param {number} numDims - Optional number of dimensions to generate
 */
const splitIntoRubricDims = async (referenceAnswer, numDims = null) => {
    const payload = {
        text: referenceAnswer
    };
    
    if (numDims) {
        payload.num_dims = numDims;
    }
    
    const response = await mlClient.post('/rubric/split', payload);
    return response.data.dimensions || [];
};

/**
 * Validate answer quality before grading
 * @param {string} answerText - Student answer text
 */
const validateAnswer = async (answerText) => {
    const response = await mlClient.post('/validate', {
        text: answerText
    });
    return response.data;
};

/**
 * Get embedding similarity between two texts
 * @param {string} text1 - First text
 * @param {string} text2 - Second text
 */
const computeSimilarity = async (text1, text2) => {
    const response = await mlClient.post('/similarity', {
        text1,
        text2
    });
    return response.data;
};

module.exports = {
    checkHealth,
    getModels,
    embed,
    grade,
    batchGrade,
    splitIntoRubricDims,
    validateAnswer,
    computeSimilarity,
    withRetry,
    mlClient
};