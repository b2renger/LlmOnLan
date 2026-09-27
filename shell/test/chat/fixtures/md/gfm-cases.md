@@@ blank-ends-list
- a

- b
@@@ two-ordered-lists
1. a

2. b
@@@ setext-underline-stays-a-paragraph
text
===
@@@ hr-closes-the-paragraph
text
---
@@@ fence-in-list-item
- item
  ```js
  a

  b
  ```
- next
@@@ inline-cap-2001
An opener whose closer is further than 2,000 characters away stays literal, so this whole
paragraph is one text run: the assertion lives in md.test.mjs because the cap is an inline rule.
@@@ table-needs-a-delimiter-row
| a | b |
| c | d |
@@@ table
| a | b | c |
|:--|--:|:-:|
| 1 | 2 | 3 |
| 4 | 5 | 6 |
@@@ blank-ends-the-table
| a | b |
|---|---|
| 1 | 2 |

after
@@@ no-lazy-continuation-out-of-a-quote
> quote
not quote
@@@ nested-quotes
> one
> > two
> back
@@@ task-items
- [ ] open
- [x] done
- plain
@@@ hr-beats-a-list-marker
- - -
@@@ heading-forms
#nospace
### with closers ###
###
@@@ raw-html-is-text
<div class="x">hello</div>
@@@ tilde-fence-with-info
~~~ python title=demo
a = 1
~~~
@@@ nested-list-by-content-column
- outer
  - inner
    - deepest
- second outer
@@@ ordered-markers
9) nine
10) ten
@@@ unclosed-fence
```js
let a = 1;
@@@ four-spaces-is-a-paragraph
    not indented code
@@@ paragraph-then-fence
text right above
```js
a
```
@@@ blank-line-then-indented-fence
1. Install it:

   ```bash
   npm i thing
   npm run build
   ```

2. Done.
@@@ top-level-indented-fence
  ```js
  a
  ```
@@@ empty
