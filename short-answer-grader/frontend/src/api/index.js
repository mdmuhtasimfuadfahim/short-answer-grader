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
    getProfile: () => api.get('/auth/profile'),
};

// Questions API
export const questionsAPI = {
    getAll: () => api.get('/questions'),
    getById: (id) => api.get(`/questions/${id}`),
    create: (data) => api.post('/questions', data),
    update: (id, data) => api.put(`/questions/${id}`, data),
    delete: (id) => api.delete(`/questions/${id}`),
};

// Rubrics API
export const rubricsAPI = {
    getByQuestion: (questionId) => api.get(`/rubrics/question/${questionId}`),
    create: (data) => api.post('/rubrics', data),
    update: (id, data) => api.put(`/rubrics/${id}`, data),
    delete: (id) => api.delete(`/rubrics/${id}`),
};

// Grading API
export const gradingAPI = {
    submitAnswer: (data) => api.post('/grading/submit', data),
    getSubmissions: (questionId) => api.get(`/grading/submissions/${questionId}`),
    getMySubmissions: () => api.get('/grading/my-submissions'),
    getSubmissionById: (id) => api.get(`/grading/submission/${id}`),
};

export default api;