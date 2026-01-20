"""
Inference module for ASAG grading.
Handles embedding generation, scoring, and explainability.
"""
import torch
import numpy as np
from typing import List, Dict, Optional, Tuple
from sentence_transformers import SentenceTransformer
import logging

from config import MODEL_CONFIGS, DEFAULT_MODEL, INFERENCE_CONFIG
from utils.preprocessing import preprocess_text
from utils.scorer import (
    compute_cosine_similarity,
    scale_similarity,
    aggregate_scores,
    compute_confidence
)
from utils.explainability import (
    compute_token_contributions,
    extract_evidence_spans,
    generate_feedback
)

logger = logging.getLogger(__name__)


class ASAGInferenceEngine:
    """
    Main inference engine for Automated Short Answer Grading.
    """
    
    def __init__(
        self,
        model_name: str = DEFAULT_MODEL,
        device: Optional[str] = None,
        use_sentence_transformers: bool = True
    ):
        self.model_name = model_name
        self.use_sentence_transformers = use_sentence_transformers
        
        # Determine device
        if device is None:
            self.device = "cuda" if torch.cuda.is_available() else "cpu"
        else:
            self.device = device
        
        # Get model config
        if model_name in MODEL_CONFIGS:
            self.config = MODEL_CONFIGS[model_name]
            self.hf_model_name = self.config["name"]
        else:
            self.hf_model_name = model_name
            self.config = {"dimension": 384, "name": model_name}
        
        logger.info(f"Loading model: {self.hf_model_name} on {self.device}")
        
        # Load model
        self._load_model()
    
    def _load_model(self):
        """Load the sentence transformer model."""
        try:
            self.model = SentenceTransformer(self.hf_model_name, device=self.device)
            logger.info(f"Model loaded successfully: {self.hf_model_name}")
        except Exception as e:
            logger.error(f"Failed to load model: {e}")
            raise
    
    def encode(
        self,
        texts: List[str],
        normalize: bool = True,
        show_progress: bool = False
    ) -> np.ndarray:
        """Encode multiple texts into embeddings."""
        if not texts:
            return np.array([])
        
        # Preprocess texts
        processed = [preprocess_text(t) for t in texts]
        
        embeddings = self.model.encode(
            processed,
            normalize_embeddings=normalize,
            show_progress_bar=show_progress,
            convert_to_numpy=True
        )
        
        return embeddings
    
    def encode_single(self, text: str, normalize: bool = True) -> np.ndarray:
        """Encode a single text into an embedding."""
        processed = preprocess_text(text)
        embedding = self.model.encode(
            processed,
            normalize_embeddings=normalize,
            convert_to_numpy=True
        )
        return embedding
    
    def get_token_embeddings(self, text: str) -> Tuple[List[str], np.ndarray]:
        """Get token-level embeddings for explainability."""
        # Simple tokenization
        tokens = text.split()
        if not tokens:
            return [], np.array([])
        
        # Encode each token individually (simplified approach)
        token_embeddings = []
        for token in tokens:
            emb = self.encode_single(token)
            token_embeddings.append(emb)
        
        return tokens, np.array(token_embeddings)
    
    def grade(
        self,
        student_answer: str,
        rubric_dims: List[str],
        rubric_names: Optional[List[str]] = None,
        weights: Optional[List[float]] = None,
        compute_explanations: bool = True
    ) -> Dict:
        """Grade a student answer against rubric dimensions."""
        if not rubric_names:
            rubric_names = [f"Dimension {i+1}" for i in range(len(rubric_dims))]
        
        # Encode student answer
        student_embedding = self.encode_single(student_answer)
        
        # Encode rubric dimensions
        rubric_embeddings = self.encode(rubric_dims)
        
        # Compute per-dimension scores
        dimension_results = {}
        scores_list = []
        feedback_texts = []
        
        for i, (dim_name, dim_text, dim_embedding) in enumerate(
            zip(rubric_names, rubric_dims, rubric_embeddings)
        ):
            # Compute similarity
            similarity = compute_cosine_similarity(student_embedding, dim_embedding)
            score = scale_similarity(similarity)
            confidence = compute_confidence(similarity)
            
            scores_list.append(score)
            
            # Compute explanations if requested
            highlights = []
            if compute_explanations:
                try:
                    tokens, token_embeddings = self.get_token_embeddings(student_answer)
                    if len(tokens) > 0 and len(token_embeddings) > 0:
                        contributions = compute_token_contributions(
                            tokens, token_embeddings, dim_embedding, method="attention"
                        )
                        highlights = extract_evidence_spans(
                            student_answer, contributions, top_k=3
                        )
                except Exception as e:
                    logger.warning(f"Failed to compute explanations: {e}")
            
            # Generate feedback
            feedback = generate_feedback(dim_name, score, highlights, dim_text, confidence)
            feedback_texts.append(feedback)
            
            dimension_results[dim_name] = {
                "score": round(score, 4),
                "confidence": round(confidence, 4),
                "highlights": highlights
            }
        
        # Aggregate overall score
        overall_score = aggregate_scores(scores_list, weights)
        
        return {
            "overall_score": round(overall_score, 4),
            "per_dimension": dimension_results,
            "feedback": feedback_texts,
            "metadata": {
                "model": self.hf_model_name,
                "model_version": "v1.0"
            }
        }
    
    def batch_grade(
        self,
        student_answers: List[str],
        rubric_dims: List[str],
        rubric_names: Optional[List[str]] = None,
        weights: Optional[List[float]] = None
    ) -> List[Dict]:
        """Batch grade multiple student answers."""
        if not rubric_names:
            rubric_names = [f"Dimension {i+1}" for i in range(len(rubric_dims))]
        
        # Encode all student answers
        student_embeddings = self.encode(student_answers)
        
        # Encode rubric dimensions (shared across all answers)
        rubric_embeddings = self.encode(rubric_dims)
        
        results = []
        for student_embedding in student_embeddings:
            dimension_results = {}
            scores_list = []
            feedback_texts = []
            
            for i, (dim_name, dim_text, dim_embedding) in enumerate(
                zip(rubric_names, rubric_dims, rubric_embeddings)
            ):
                similarity = compute_cosine_similarity(student_embedding, dim_embedding)
                score = scale_similarity(similarity)
                confidence = compute_confidence(similarity)
                
                scores_list.append(score)
                
                feedback = generate_feedback(dim_name, score, [], dim_text, confidence)
                feedback_texts.append(feedback)
                
                dimension_results[dim_name] = {
                    "score": round(score, 4),
                    "confidence": round(confidence, 4),
                    "highlights": []
                }
            
            overall_score = aggregate_scores(scores_list, weights)
            
            results.append({
                "overall_score": round(overall_score, 4),
                "per_dimension": dimension_results,
                "feedback": feedback_texts,
                "metadata": {
                    "model": self.hf_model_name,
                    "model_version": "v1.0"
                }
            })
        
        return results


# Global engine instance
_engine: Optional[ASAGInferenceEngine] = None


def get_engine(model_name: str = DEFAULT_MODEL) -> ASAGInferenceEngine:
    """Get or create the global inference engine."""
    global _engine
    if _engine is None or _engine.model_name != model_name:
        _engine = ASAGInferenceEngine(model_name=model_name)
    return _engine


def grade_answer(
    student_answer: str,
    rubric_dims: List[str],
    rubric_names: Optional[List[str]] = None,
    weights: Optional[List[float]] = None,
    model_name: str = DEFAULT_MODEL
) -> Dict:
    """Convenience function to grade a single answer."""
    engine = get_engine(model_name)
    return engine.grade(student_answer, rubric_dims, rubric_names, weights)


def embed_text(text: str, model_name: str = DEFAULT_MODEL) -> List[float]:
    """Convenience function to embed a single text."""
    engine = get_engine(model_name)
    embedding = engine.encode_single(text)
    return embedding.tolist()