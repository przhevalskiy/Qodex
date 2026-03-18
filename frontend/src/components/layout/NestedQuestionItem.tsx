import { useRef, useEffect, useLayoutEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { SampleQuestion } from '@/shared/types/sampleQuestions';

interface NestedQuestionItemProps {
  question: SampleQuestion;
  onQuestionSelect: (question: string) => void;
}

export function NestedQuestionItem({ question, onQuestionSelect }: NestedQuestionItemProps) {
  const [showSubMenu, setShowSubMenu] = useState(false);
  const [subMenuStyle, setSubMenuStyle] = useState<React.CSSProperties>({ visibility: 'hidden' });
  const itemRef = useRef<HTMLButtonElement>(null);
  const subMenuRef = useRef<HTMLDivElement>(null);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // After submenu renders, measure its actual height and reposition if it would overflow
  useLayoutEffect(() => {
    if (showSubMenu && itemRef.current && subMenuRef.current) {
      const rect = itemRef.current.getBoundingClientRect();
      const menuHeight = subMenuRef.current.offsetHeight;
      const menuWidth = 240;
      const gap = 4;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      // Horizontal: prefer right, fall back to left
      let left = rect.right + gap;
      if (left + menuWidth > viewportWidth) {
        left = rect.left - menuWidth - gap;
      }

      // Vertical: align top with item, but clamp so bottom doesn't overflow
      let top = rect.top;
      if (top + menuHeight > viewportHeight - 8) {
        top = viewportHeight - menuHeight - 8;
      }

      setSubMenuStyle({ top: `${top}px`, left: `${left}px`, width: `${menuWidth}px`, visibility: 'visible' });
    }
  }, [showSubMenu]);

  const handleMouseEnter = () => {
    // Clear any existing timeout
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }

    // Show sub-menu after delay
    hoverTimeoutRef.current = setTimeout(() => {
      setShowSubMenu(true);
    }, 150);
  };

  const handleMouseLeave = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    hoverTimeoutRef.current = setTimeout(() => {
      setShowSubMenu(false);
      setSubMenuStyle({ visibility: 'hidden' });
    }, 100);
  };

  const handleSubMenuMouseEnter = () => {
    // Cancel any pending close timeout when entering sub-menu
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
  };

  const handleSubMenuMouseLeave = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    hoverTimeoutRef.current = setTimeout(() => {
      setShowSubMenu(false);
      setSubMenuStyle({ visibility: 'hidden' });
    }, 100);
  };

  const handleMainQuestionClick = () => {
    onQuestionSelect(question.main);
    setShowSubMenu(false);
  };

  const handleSubQuestionClick = (subQuestionText: string) => {
    onQuestionSelect(subQuestionText);
    setShowSubMenu(false);
  };

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
    };
  }, []);

  return (
    <>
      <button
        ref={itemRef}
        className="sample-question-item sample-question-item-with-sub"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={handleMainQuestionClick}
        aria-haspopup="true"
        aria-expanded={showSubMenu}
      >
        <span className="sample-question-item-text">{question.main}</span>
        <ChevronRight size={14} className="sample-question-item-chevron" />
      </button>

      {showSubMenu && (
        <div
          ref={subMenuRef}
          className="sample-questions-submenu"
          style={subMenuStyle}
          onMouseEnter={handleSubMenuMouseEnter}
          onMouseLeave={handleSubMenuMouseLeave}
        >
          {question.subQuestions.map((subQuestion, index) => (
            <button
              key={index}
              className="sample-subquestion-item"
              onClick={() => handleSubQuestionClick(subQuestion.text)}
            >
              {subQuestion.text}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
