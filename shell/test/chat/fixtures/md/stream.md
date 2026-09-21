# Streaming fixture

This paragraph has **strong**, *em*, `code`, ~~del~~ and a hard break at the end.
It runs over two lines, with an https://example.com/docs link and a mailto:someone@example.com
address that must stay plain text. Citations look like [2] and an out-of-range one like [9].

## Every block type

- a bullet item
- a second item with a nested list
  - nested one
  - nested two
- [ ] an open task
- [x] a done task

1. first ordered item
2. second ordered item

> a blockquote
> > nested deeper
> back to the first level

| Column | Value | Note |
|--------|------:|:----:|
| alpha  |     1 | ok   |
| beta   |    22 | also |

---

### Code

A harmless Blender snippet:

```python
import bpy
bpy.ops.mesh.primitive_cube_add(size=2)
print("a cube was added")
```

A snippet that fails when it runs:

```python
raise RuntimeError('boom')
```

An SVG fence for the preview tab:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
  <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2" />
</svg>
```

A fence inside a list item:

- the item text
  ```js
  const a = 1;

  const b = a + 1;
  ```
- the item after it

#### Tail

The last paragraph ends without a trailing newline problem.
