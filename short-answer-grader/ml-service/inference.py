"""
Inference module for ASAG grading.
Handles embedding generation, scoring, and explainability.
"""
import torch
import numpy as np
from typing import List, Dict, Optional, Tuple
from sentence_transformers import SentenceTransformer
from transformers import AutoTokenizer, AutoModel
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
    
    Supports multiple encoder models and provides:
    - Text embedding
    - Rubric-based scoring
    - Explainability (evidence spans)
    - Confidence estimation
    """
    
    def __init__(
        self,
        model_name: str = DEFAULT_MODEL,
        device: Optional[str] = None,
        use_sentence_transformers: bool = True
    ):
        """
        Initialize the inference engine.
        
        Args:
            model_name: Model key from MODEL_CONFIGS or HuggingFace model name
            device: Device to use ('cuda', 'cpu', or None for auto)
            use_sentence_transformers: Use sentence-transformers library (recommended)
        """
        self.model_name = model_name
        self.use_sentence_transformers = use_sentence_transformers
        
        # Determine device
        if device is None:
            self.device = "cuda" if torch.cuda.is_available() else "cpu"
        else:
            self.device = device
        
        # Get model config
        if model_name in MODEL_CONFIGS:
            self.model_config = MODEL_CONFIGS[model_name]
            self.hf_model_name = self.model_config["name"]
        else:
            self.model_config = {"name": model_name, "dimension": 768}
            self.hf_model_name = model_name
        
        # Load model
        self._load_model()
        
        logger.info(f"Initialized ASAG engine with {self.hf_model_name} on {self.device}")
    
    def _load_model(self):
        """Load the encoder model and tokenizer."""
        if self.use_sentence_transformers:
            self.model = SentenceTransformer(self.hf_model_name, device=self.device)
            self.tokenizer = self.model.tokenizer
        else:
            self.tokenizer = AutoTokenizer.from_pretrained(self.hf_model_name)
            self.model = AutoModel.from_pretrained(self.hf_model_name).to(self.device)
            self.model.eval()
    
    def encode(
        self,
        texts: List[str],
        normalize: bool = True,
        show_progress: bool = False
    ) -> np.ndarray:
        """
        Encode texts to embeddings.
        
        Args:
            texts: List of text strings
            normalize: Whether to L2 normalize embeddings
            show_progress: Show progress bar
            
        Returns:
            Numpy array of embeddings (N x D)
        """
        # Preprocess texts
        texts = [preprocess_text(t) for t in texts]
        
        if self.use_sentence_transformers:
            embeddings = self.model.encode(
                texts,
                normalize_embeddings=normalize,
                show_progress_bar=show_progress,
                convert_to_numpy=True
            )
        else:
            # Manual encoding with HuggingFace model
            with torch.no_grad():
                inputs = self.tokenizer(
                    texts,
                    padding=True,
                    truncation=True,
                    max_length=INFERENCE_CONFIG["max_seq_length"],
                    return_tensors="pt"
                ).to(self.device)
                
                outputs = self.model(**inputs)
                
                # Mean pooling
                attention_mask = inputs["attention_mask"]
                token_embeddings = outputs.last_hidden_state
                mask_expanded = attention_mask.unsqueeze(-1).expand(token_embeddings.size()).float()
                sum_embeddings = torch.sum(token_embeddings * mask_expanded, dim=1)
                sum_mask = mask_expanded.sum(dim=1).clamp(min=1e-9)
                embeddings = (sum_embeddings / sum_mask).cpu().numpy()
                
                if normalize:
                    norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
                    embeddings = embeddings / np.maximum(norms, 1e-9)
        
        return embeddings
    
    def encode_single(self, text: str, normalize: bool = True) -> np.ndarray:
        """Encode a single text to embedding."""
        return self.encode([text], normalize=normalize)[0]
    
    def get_token_embeddings(self, text: str) -> Tuple[List[str], np.ndarray]:
        """
        Get per-token embeddings for explainability.
        
        Args:
            text: Input text
            
        Returns:
            Tuple of (tokens, token_embeddings)
        """
        text = preprocess_text(text)
        
        with torch.no_grad():
            inputs = self.tokenizer(
                text,
                padding=True,
                truncation=True,
                max_length=INFERENCE_CONFIG["max_seq_length"],
                return_tensors="pt"
            ).to(self.device)
            
            if self.use_sentence_transformers:
                outputs = self.model[0].auto_model(**inputs)
            else:
                outputs = self.model(**inputs)
            
            token_embeddings = outputs.last_hidden_state[0].cpu().numpy()
            tokens = self.tokenizer.convert_ids_to_tokens(inputs["input_ids"][0])
        
        # Filter out special tokens
        valid_indices = [
            i for i, t in enumerate(tokens) 
            if t not in self.tokenizer.all_special_tokens
        ]
        
        filtered_tokens = [tokens[i] for i in valid_indices]
        filtered_embeddings = token_embeddings[valid_indices]
        
        return filtered_tokens, filtered_embeddings
    
    def grade(
        self,
        student_answer: str,
        rubric_dims: List[str],
        rubric_names: Optional[List[str]] = None,
        weights: Optional[List[float]] = None,
        compute_explanations: bool = True
    ) -> Dict:
        """
        Grade a student answer against rubric dimensions.
        
        Args:
            student_answer: The student's response text
            rubric_dims: List of rubric dimension texts/requirements
            rubric_names: Optional names for each dimension
            weights: Optional weights for aggregation
            compute_explanations: Whether to compute evidence spans
            
        Returns:
            Grading result dictionary
        """
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
                tokens, token_embeddings = self.get_token_embeddings(student_answer)
                contributions = compute_token_contributions(
                    tokens, token_embeddings, dim_embedding, method="attention"
                )
                highlights = extract_evidence_spans(
                    student_answer,
                    contributions,
                    top_k=INFERENCE_CONFIG["top_k_spans"]
                )
            
            # Generate feedback
            feedback = generate_feedback(dim_name, score, highlights, dim_text, confidence)
            feedback_texts.append(feedback)
            
            dimension_results[dim_name] = {
                "score": round(score, 4),
                "confidence": round(confidence, 4),
                "highlights": [
                    {
                        "text": h["text"],
                        "score": round(h["score"], 4),
                        "char_start": h.get("char_start"),
                        "char_end": h.get("char_end")
                    }
                    for h in highlights
                ]
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
        """
        Grade multiple student answers efficiently.
        
        Args:
            student_answers: List of student responses
            rubric_dims: List of rubric dimension texts
            rubric_names: Optional names for dimensions
            weights: Optional weights
            
        Returns:
            List of grading result dictionaries
        """
        if not rubric_names:
            rubric_names = [f"Dimension {i+1}" for i in range(len(rubric_dims))]
        
        # Batch encode all texts
        student_embeddings = self.encode(student_answers, show_progress=True)
        rubric_embeddings = self.encode(rubric_dims)
        
        results = []
        for student_embedding, student_answer in zip(student_embeddings, student_answers):
            dimension_results = {}
            scores_list = []
            
            for dim_name, dim_embedding in zip(rubric_names, rubric_embeddings):
                similarity = compute_cosine_similarity(student_embedding, dim_embedding)
                score = scale_similarity(similarity)
                confidence = compute_confidence(similarity)
                
                scores_list.append(score)
                dimension_results[dim_name] = {
                    "score": round(score, 4),
                    "confidence": round(confidence, 4),
                    "highlights": []  # Skip for batch efficiency
                }
            
            overall_score = aggregate_scores(scores_list, weights)
            
            results.append({
                "overall_score": round(overall_score, 4),
                "per_dimension": dimension_results,
                "feedback": [],
                "metadata": {"model": self.hf_model_name}
            })
        
        return results


# Global engine instance (lazy initialization)
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
    """
    Convenience function to grade a single answer.
    
    Args:
        student_answer: Student's response
        rubric_dims: Rubric dimension texts
        rubric_names: Names for dimensions
        weights: Aggregation weights
        model_name: Model to use
        
    Returns:
        Grading result dictionary
    """
    engine = get_engine(model_name)
    return engine.grade(student_answer, rubric_dims, rubric_names, weights)


def embed_text(text: str, model_name: str = DEFAULT_MODEL) -> List[float]:
    """
    Convenience function to embed a single text.
    
    Args:
        text: Input text
        model_name: Model to use
        
    Returns:
        Embedding as list of floats
    """
    engine = get_engine(model_name)
    embedding = engine.encode_single(text)
    return embedding.tolist()