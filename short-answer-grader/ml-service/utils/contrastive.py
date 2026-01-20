"""
Contrastive learning utilities for robust ASAG.
Implements InfoNCE loss and negative sample generation.
"""
import torch
import torch.nn as nn
import torch.nn.functional as F
import numpy as np
import random
from typing import List, Tuple, Optional
from numpy.typing import NDArray


class ContrastiveLoss(nn.Module):
    """
    InfoNCE contrastive loss for fine-tuning sentence encoders.
    
    This loss encourages the model to:
    - Increase similarity between student answers and matching rubric dimensions
    - Decrease similarity with non-matching rubrics and adversarial examples
    """
    
    def __init__(self, temperature: float = 0.07):
        """
        Initialize contrastive loss.
        
        Args:
            temperature: Temperature parameter for softmax scaling
        """
        super().__init__()
        self.temperature = temperature
    
    def forward(
        self,
        anchor: torch.Tensor,
        positive: torch.Tensor,
        negatives: torch.Tensor
    ) -> torch.Tensor:
        """
        Compute InfoNCE loss.
        
        Args:
            anchor: Anchor embeddings (batch_size, embedding_dim) - student answers
            positive: Positive embeddings (batch_size, embedding_dim) - matching rubrics
            negatives: Negative embeddings (batch_size, num_negatives, embedding_dim)
            
        Returns:
            Scalar loss tensor
        """
        batch_size = anchor.size(0)
        
        # Normalize embeddings
        anchor = F.normalize(anchor, p=2, dim=1)
        positive = F.normalize(positive, p=2, dim=1)
        negatives = F.normalize(negatives, p=2, dim=2)
        
        # Positive similarity: (batch_size,)
        pos_sim = torch.sum(anchor * positive, dim=1) / self.temperature
        
        # Negative similarities: (batch_size, num_negatives)
        neg_sim = torch.bmm(negatives, anchor.unsqueeze(2)).squeeze(2) / self.temperature
        
        # Concatenate positive and negative similarities
        # logits shape: (batch_size, 1 + num_negatives)
        logits = torch.cat([pos_sim.unsqueeze(1), neg_sim], dim=1)
        
        # Labels: positive is always at index 0
        labels = torch.zeros(batch_size, dtype=torch.long, device=anchor.device)
        
        # Cross-entropy loss
        loss = F.cross_entropy(logits, labels)
        
        return loss


class CombinedLoss(nn.Module):
    """
    Combined contrastive and regression loss for ASAG training.
    """
    
    def __init__(
        self,
        temperature: float = 0.07,
        alpha: float = 0.5,
        beta: float = 0.5
    ):
        """
        Initialize combined loss.
        
        Args:
            temperature: Temperature for contrastive loss
            alpha: Weight for contrastive loss
            beta: Weight for regression loss
        """
        super().__init__()
        self.contrastive_loss = ContrastiveLoss(temperature)
        self.regression_loss = nn.MSELoss()
        self.alpha = alpha
        self.beta = beta
    
    def forward(
        self,
        anchor: torch.Tensor,
        positive: torch.Tensor,
        negatives: torch.Tensor,
        predicted_scores: torch.Tensor,
        true_scores: torch.Tensor
    ) -> Tuple[torch.Tensor, dict]:
        """
        Compute combined loss.
        
        Args:
            anchor: Student answer embeddings
            positive: Matching rubric embeddings  
            negatives: Non-matching/adversarial embeddings
            predicted_scores: Model's predicted scores
            true_scores: Ground truth scores
            
        Returns:
            Tuple of (total_loss, loss_components_dict)
        """
        # Contrastive component
        con_loss = self.contrastive_loss(anchor, positive, negatives)
        
        # Regression component
        reg_loss = self.regression_loss(predicted_scores, true_scores)
        
        # Combined loss
        total_loss = self.alpha * con_loss + self.beta * reg_loss
        
        return total_loss, {
            "contrastive_loss": con_loss.item(),
            "regression_loss": reg_loss.item(),
            "total_loss": total_loss.item()
        }


def create_negative_samples(
    student_answer: str,
    rubric_dim: str,
    other_answers: List[str],
    other_rubrics: List[str],
    num_negatives: int = 5,
    include_adversarial: bool = True
) -> List[str]:
    """
    Create negative samples for contrastive learning.
    
    Negative types:
    1. In-batch negatives: other student answers from different questions
    2. Mismatched rubrics: rubrics from other questions
    3. Adversarial: keyword-stuffed or perturbed versions
    
    Args:
        student_answer: The current student answer (anchor)
        rubric_dim: The current rubric dimension (positive)
        other_answers: Pool of other student answers
        other_rubrics: Pool of other rubric dimensions
        num_negatives: Number of negatives to generate
        include_adversarial: Whether to include synthetic adversarial examples
        
    Returns:
        List of negative text samples
    """
    negatives = []
    
    # 1. Sample from other answers (in-batch negatives)
    if other_answers:
        n_other = min(num_negatives // 2, len(other_answers))
        negatives.extend(random.sample(other_answers, n_other))
    
    # 2. Sample from mismatched rubrics
    if other_rubrics:
        n_rubric = min(num_negatives // 4, len(other_rubrics))
        negatives.extend(random.sample(other_rubrics, n_rubric))
    
    # 3. Generate adversarial samples
    if include_adversarial:
        remaining = num_negatives - len(negatives)
        adversarial = generate_adversarial_samples(student_answer, rubric_dim, remaining)
        negatives.extend(adversarial)
    
    return negatives[:num_negatives]


def generate_adversarial_samples(
    student_answer: str,
    rubric_dim: str,
    num_samples: int = 2
) -> List[str]:
    """
    Generate adversarial negative samples.
    
    Types:
    1. Keyword stuffing: Insert rubric keywords randomly
    2. Shuffled: Randomly shuffle words
    3. Partial: Take only part of the answer
    
    Args:
        student_answer: Original answer
        rubric_dim: Target rubric dimension
        num_samples: Number of adversarial samples
        
    Returns:
        List of adversarial text samples
    """
    adversarial = []
    words = student_answer.split()
    rubric_words = rubric_dim.split()
    
    # 1. Keyword stuffing
    if len(words) > 3:
        # Insert random rubric keywords
        stuffed = words.copy()
        for _ in range(min(3, len(rubric_words))):
            insert_pos = random.randint(0, len(stuffed))
            keyword = random.choice(rubric_words)
            stuffed.insert(insert_pos, keyword)
        adversarial.append(" ".join(stuffed))
    
    # 2. Word shuffle
    if len(words) > 5:
        shuffled = words.copy()
        random.shuffle(shuffled)
        adversarial.append(" ".join(shuffled))
    
    # 3. Truncated (meaning loss)
    if len(words) > 6:
        mid = len(words) // 2
        truncated = words[:mid]
        adversarial.append(" ".join(truncated))
    
    # 4. Random words (fluent but irrelevant)
    filler_words = [
        "the", "a", "is", "are", "was", "were", "been", "being",
        "have", "has", "had", "do", "does", "did", "will", "would",
        "could", "should", "may", "might", "must", "shall", "can"
    ]
    random_text = " ".join(random.choices(filler_words, k=len(words)))
    adversarial.append(random_text)
    
    return adversarial[:num_samples]


def hard_negative_mining(
    anchor_embedding: NDArray[np.float32],
    candidate_embeddings: NDArray[np.float32],
    candidate_texts: List[str],
    num_hard_negatives: int = 3,
    exclude_top_k: int = 1
) -> List[str]:
    """
    Select hard negatives based on embedding similarity.
    
    Hard negatives are samples that are similar to the anchor but incorrect.
    They provide more informative gradients during training.
    
    Args:
        anchor_embedding: Embedding of the anchor sample
        candidate_embeddings: Embeddings of candidate negatives
        candidate_texts: Text of candidate negatives
        num_hard_negatives: Number of hard negatives to select
        exclude_top_k: Exclude top-k most similar (might be actual positives)
        
    Returns:
        List of hard negative texts
    """
    # Compute similarities
    anchor_norm = np.linalg.norm(anchor_embedding)
    if anchor_norm == 0:
        return random.sample(candidate_texts, min(num_hard_negatives, len(candidate_texts)))
    
    anchor_normalized = anchor_embedding / anchor_norm
    
    cand_norms = np.linalg.norm(candidate_embeddings, axis=1, keepdims=True)
    cand_norms = np.where(cand_norms == 0, 1, cand_norms)
    cand_normalized = candidate_embeddings / cand_norms
    
    similarities = np.dot(cand_normalized, anchor_normalized)
    
    # Get indices sorted by similarity (descending)
    sorted_indices = np.argsort(similarities)[::-1]
    
    # Select hard negatives: similar but not too similar
    # Skip the top-k most similar (might be positives)
    hard_indices = sorted_indices[exclude_top_k:exclude_top_k + num_hard_negatives]
    
    return [candidate_texts[i] for i in hard_indices]