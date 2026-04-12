# Ticket Evaluation — Feature Decomposition Workflow

**Persona:** Product Manager
**Purpose:** Decompose a feature request into scoped, layered subtasks with clear acceptance criteria.

## Step 1: Scope Validation

Before decomposing, answer these questions:

1. **Is this required by the assessment?** If not, deprioritize.
2. **What is the minimum viable implementation?** Strip to essentials.
3. **What are the inputs and outputs?** Define the data flow.
4. **Who is the user?** What's their goal?

## Step 2: Sizing

Estimate complexity on a T-shirt scale:

| Size | Effort | Example |
|------|--------|---------|
| **XS** | < 1 hour | Add a prop, fix a typo, simple styling |
| **S** | 1-2 hours | New component, simple hook, utility function |
| **M** | 2-4 hours | Feature with state management, API integration |
| **L** | 4-8 hours | Full feature with tests, error handling, edge cases |
| **XL** | 8+ hours | Cross-cutting concern, major refactor — break it down further |

## Step 3: Layer Decomposition

Break the feature into architecture layers. Implement in this order:

### 1. Domain Layer (implement first)
- Models / types / interfaces
- Business logic / validation rules
- Service interfaces

### 2. Data Layer
- API client implementation
- Storage / persistence
- DTOs and mappers

### 3. Presentation Layer
- State management (hooks / stores)
- Event handlers
- Side effects

### 4. UI Layer (implement last)
- Components
- Layouts
- Styling
- Accessibility

## Step 4: Acceptance Criteria

For each subtask, define AC in Given/When/Then format:

```
Given: [precondition]
When: [user action or system event]
Then: [expected outcome]
```

Example:
```
Given: a user has entered a campaign brief
When: they click "Generate Ad"
Then: the system displays a loading state, calls the AI API,
      and renders the generated ad creative within 5 seconds
```

## Output Template

```markdown
## Feature: [Name]
**Size:** [T-shirt] | **Priority:** [P0/P1/P2]

### Subtasks (in implementation order)

1. **[Domain] Define models and service interface** (XS)
   - AC: Types compile, interfaces defined
   
2. **[Data] Implement API client** (S)
   - AC: Given valid input, When API is called, Then response maps to domain model
   
3. **[Presentation] Create state hook** (S)
   - AC: Given initial state, When action dispatched, Then state updates correctly
   
4. **[UI] Build component** (M)
   - AC: Given state, When rendered, Then displays correctly with a11y
```
