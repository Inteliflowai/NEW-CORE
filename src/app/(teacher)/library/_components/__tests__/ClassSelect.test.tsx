// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ClassSelect } from '../ClassSelect';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

beforeEach(() => { push.mockReset(); });

const classes = [
  { id: 'c1', label: 'Biology — Period 3' },
  { id: 'c2', label: 'Chemistry — Period 4' },
];

describe('ClassSelect', () => {
  it('renders nothing when the teacher has one class or fewer', () => {
    const { container } = render(<ClassSelect classes={[classes[0]]} currentClassId="c1" basePath="/library/lessons" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders an option per class with the current one selected (>1 class)', () => {
    render(<ClassSelect classes={classes} currentClassId="c2" basePath="/library/lessons" />);
    const select = screen.getByLabelText('Class') as HTMLSelectElement;
    expect(select.value).toBe('c2');
    expect(screen.getByRole('option', { name: 'Biology — Period 3' })).toBeInTheDocument();
  });

  it('navigates to basePath?class=<id> on change', () => {
    render(<ClassSelect classes={classes} currentClassId="c1" basePath="/library/quizzes" />);
    fireEvent.change(screen.getByLabelText('Class'), { target: { value: 'c2' } });
    expect(push).toHaveBeenCalledWith('/library/quizzes?class=c2');
  });
});
