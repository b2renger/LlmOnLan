# XSS corpus

Raw HTML must stay text: <script>window.__pwned = 1</script> and <img src=x onerror="window.__pwned=1">
and <svg onload="window.__pwned=1"></svg> and <iframe src="javascript:window.__pwned=1"></iframe>.

An attribute breakout attempt: <a href="#" onmouseover="window.__pwned=1">hover</a>.

Dangerous link schemes, none of which may become an anchor:

- [script link](javascript:window.__pwned=1)
- [data link](data:text/html;base64,PHNjcmlwdD53aW5kb3cuX19wd25lZD0xPC9zY3JpcHQ+)
- [file link](file:///etc/passwd)
- [vbscript link](vbscript:msgbox(1))
- [mail link](mailto:someone@example.com)
- [entity encoded](&#106;avascript&#58;window.__pwned=1)
- [hex entity](&#x6a;&#x61;&#x76;&#x61;&#x73;&#x63;&#x72;&#x69;&#x70;&#x74;&#x3a;alert(1))
- [double encoded](&amp;#106;avascript:alert(1))
- [tab obfuscated](java&#09;script:alert(1))
- [newline obfuscated](java&#10;script:alert(1))
- [leading space](   javascript:alert(1))
- [protocol relative](//evil.example.com/x)
- [uppercase](JAVASCRIPT:alert(1))
- [safe http](http://example.com/ok)
- [safe https](https://example.com/ok?a=1&amp;b=2)

An autolink with a bad scheme: <javascript:alert(1)> and a good one: <https://example.com/auto>.

A markdown image that must never load: ![alt text](https://example.com/evil.png) and one with a
dangerous source: ![bad](javascript:alert(1)).

Nested backticks and a fence that tries to escape:

`` a ` b `` and ``` c ``` and `<script>alert(1)</script>`

```html
<script>window.__pwned = 1</script>
<img src=x onerror=alert(1)>
```

```svg
<svg xmlns="http://www.w3.org/2000/svg" onload="window.__pwned=1"><foreignObject><body>
<script>window.__pwned=1</script></body></foreignObject></svg>
```

A table whose cells carry markup:

| cell | attack |
|------|--------|
| one | <img src=x onerror=alert(1)> |
| two | [x](javascript:alert(1)) |

> A quote with <b onclick="window.__pwned=1">markup</b> inside.

- A task with markup: [x] <script>alert(1)</script>

<!-- BIG-LINE:1048576 -->  the unit test replaces this marker line with a real 1 MB line of
"<script>alert(1)</script> " repeats, so the corpus exercises the megabyte case without a
megabyte in the repository.

The end.
