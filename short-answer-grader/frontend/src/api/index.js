import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5001/api';

const api = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        'Content-Type': 'application/json',
    },
});

// Request interceptor to add auth token
api.interceptors.request.use(
    (config) => {
        const token = localStorage.getItem('token');
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
    },
    (error) => {
        return Promise.reject(error);
    }
);

// Response interceptor for error handling
api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401) {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            window.location.href = '/login';
        }
        return Promise.reject(error);
    }
);

// Auth API
export const authAPI = {
    login: (email, password) => api.post('/auth/login', { email, password }),
    register: (userData) => api.post('/auth/register', userData),
    getProfile: () => api.get('/auth/me'),
};

// Questions API
export const questionsAPI = {
    getAll: () => api.get('/questions'),
    getById: (id) => api.get(`/questions/${id}`),
    create: (data) => api.post('/questions', data),
    update: (id, data) => api.put(`/questions/${id}`, data),
    delete: (id) => api.delete(`/questions/${id}`),
    getStats: (id) => api.get(`/questions/${id}/stats`),
};

// Rubrics API
export const rubricsAPI = {
    getAll: () => api.get('/rubrics'),
    getById: (id) => api.get(`/rubrics/${id}`),
    getByQuestion: (questionId) => api.get(`/rubrics?questionId=${questionId}`),
    create: (data) => api.post('/rubrics', data),
    update: (id, data) => api.put(`/rubrics/${id}`, data),
    delete: (id) => api.delete(`/rubrics/${id}`),
    clone: (id, data) => api.post(`/rubrics/${id}/clone`, data),
    normalize: (id) => api.post(`/rubrics/${id}/normalize`),
};

// Grading API
export const gradingAPI = {
    submitAnswer: (data) => api.post('/grading/submit', data),
    getMySubmissions: () => api.get('/grading/my-submissions'),
    getSubmission: (id) => api.get(`/grading/submissions/${id}`),
    getQuestionSubmissions: (questionId) => api.get(`/grading/questions/${questionId}/submissions`),
    overrideScore: (id, data) => api.put(`/grading/submissions/${id}/override`, data),
    regrade: (id) => api.post(`/grading/submissions/${id}/regrade`),
    batchGrade: (data) => api.post('/grading/batch-grade', data),
    checkHealth: () => api.get('/grading/health'),
};

export default api;