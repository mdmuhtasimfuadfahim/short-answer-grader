"""
Configuration settings for the ML microservice.
"""
import os
from pathlib import Path

# Base paths
BASE_DIR = Path(__file__).parent
MODELS_DIR = BASE_DIR / "models"
DATA_DIR = BASE_DIR.parent / "data"

# Model configurations
MODEL_CONFIGS = {
    "minilm": {
        "name": "all-MiniLM-L6-v2",
        "dimension": 384,
        "description": "Fast, lightweight encoder for rapid prototyping"
    },
    "sbert": {
        "name": "all-mpnet-base-v2",
        "dimension": 768,
        "description": "Balanced encoder with good semantic fidelity"
    },
    "deberta": {
        "name": "microsoft/deberta-v3-base",
        "dimension": 768,
        "description": "Highest accuracy, larger model"
    }
}

# Default model
DEFAULT_MODEL = os.getenv("DEFAULT_MODEL", "minilm")

# Training hyperparameters
TRAINING_CONFIG = {
    "learning_rate": 2e-5,
    "batch_size": 16,
    "epochs": 5,
    "temperature": 0.07,  # Contrastive loss temperature
    "alpha": 0.5,  # Weight for contrastive loss
    "beta": 0.5,   # Weight for regression loss
    "warmup_ratio": 0.1
}

# Inference settings
INFERENCE_CONFIG = {
    "max_seq_length": 512,
    "top_k_spans": 3,  # Number of evidence spans to return
    "confidence_threshold": 0.5
}

# Server settings
SERVER_CONFIG = {
    "host": os.getenv("ML_SERVICE_HOST", "0.0.0.0"),
    "port": int(os.getenv("ML_SERVICE_PORT", 8001)),
    "workers": int(os.getenv("ML_SERVICE_WORKERS", 1))
}