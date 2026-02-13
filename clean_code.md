Code is clean if it can be understood easily – by everyone on the team. Clean code can be read and enhanced by a developer other than its original author. With understandability comes readability, changeability, extensibility and maintainability.

---

## General rules

- **Follow standard conventions**: Follow the coding standards and conventions of the project.
- **Keep it simple**: Simpler is always better. Reduce complexity as much as possible.
- **Boy scout rule**: Leave the campground cleaner than you found it.
- **Always find root cause**: Always look for the root cause of a problem.

## Design rules

- **Keep configurable data at high levels**: Configuration should be at the top level of the application.
- **Prefer polymorphism to if/else or switch/case**: Use polymorphism to avoid complex conditional logic.
- **Separate multi-threading code**: Keep concurrent code isolated and clearly marked.
- **Prevent over-configurability**: Avoid making everything configurable.
- **Use dependency injection**: Pass dependencies explicitly rather than creating them internally.
- **Follow Law of Demeter**: A class should know only its direct dependencies.

## Understandability tips

- **Be consistent**: If you do something a certain way, do all similar things in the same way.
- **Use explanatory variables**: Extract complex expressions into well-named variables.
- **Encapsulate boundary conditions**: Boundary conditions are hard to keep track of. Put the processing for them in one place.
- **Prefer dedicated value objects to primitive type**: Use domain-specific types instead of primitives.
- **Avoid logical dependency**: Don't write methods which work correctly depending on something else in the same class.
- **Avoid negative conditionals**: Prefer positive conditionals for better readability.

## Names rules

- **Use Intention-Revealing Names**: `elapsedTimeInDays` instead of `d`.
- **Avoid Disinformation**: Don't use `accountList` if it's actually a `Map`.
- **Make Meaningful Distinctions**: Avoid `ProductData` vs `ProductInfo`.
- **Use Pronounceable/Searchable Names**: Avoid `genymdhms`.
- **Class Names**: Use nouns (`Customer`, `WikiPage`). Avoid `Manager`, `Data`.
- **Method Names**: Use verbs (`postPayment`, `deletePage`).

## Functions rules

- **Small!**: Functions should be shorter than you think.
- **Do One Thing**: A function should do only one thing, and do it well.
- **One Level of Abstraction**: Don't mix high-level business logic with low-level details (like regex).
- **Descriptive Names**: `isPasswordValid` is better than `check`.
- **Arguments**: 0 is ideal, 1-2 is okay, 3+ requires a very strong justification.
- **No Side Effects**: Functions shouldn't secretly change global state.

## Comments rules

- **Don't Comment Bad Code—Rewrite It**: Most comments are a sign of failure to express ourselves in code.
- **Explain Yourself in Code**:
    ```python
    # Check if employee is eligible for full benefits
    if employee.flags & HOURLY and employee.age > 65:
    ```
    vs
    ```python
    if employee.isEligibleForFullBenefits():
    ```
- **Good Comments**: Legal, Informative (regex intent), Clarification (external libraries), TODOs.
- **Bad Comments**: Mumbling, Redundant, Misleading, Mandated, Noise, Position Markers.

## Source code structure

- **The Newspaper Metaphor**: High-level concepts at the top, details at the bottom.
- **Vertical Density**: Related lines should be close to each other.
- **Distance**: Variables should be declared near their usage.
- **Indentation**: Essential for structural readability.

## Objects and data structures

- **Data Abstraction**: Hide the implementation behind interfaces.
- **The Law of Demeter**: A module should not know about the innards of the objects it manipulates. Avoid `a.getB().getC().doSomething()`.
- **Data Transfer Objects (DTO)**: Classes with public variables and no functions.

## Unit Tests

- **The Three Laws of TDD**:
    1. Don't write production code until you have a failing unit test.
    2. Don't write more of a unit test than is sufficient to fail.
    3. Don't write more production code than is sufficient to pass the failing test.
- **F.I.R.S.T. Principles**: Fast, Independent, Repeatable, Self-Validating, Timely.

## Classes

- **Small!**: Classes should have a single responsibility (SRP).
- **The Stepdown Rule**: We want the code to read like a top-down narrative.

## Code smells

- **Rigidity**: Hard to change.
- **Fragility**: Breaks in many places.
- **Immobility**: Hard to reuse.
- **Viscosity**: Hard to do the right thing.
- **Needless Complexity/Repetition**.
