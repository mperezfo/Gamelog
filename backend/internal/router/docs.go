package router

import (
	"net/http"
	"strings"
)

// The documentation page is served from here rather than by Huma.
//
// It is the page Huma would have rendered, deliberately kept as close to it as
// possible: the same renderer at the same pinned version, behind the same
// integrity hashes, the same content security policy and the same three-column
// layout. The only thing added is a stylesheet, and the only thing in the
// stylesheet is the rule that hides the mark the renderer leaves in its
// footer — which is the whole reason this page exists, since Huma offers no
// way in for one.
//
// The page is a desktop page. Elements is hard to use on a phone and the ways
// out of that are worse than the problem: its stacked layout has to be chosen
// before the element exists, which means measuring the window in a script and
// rebuilding the reader whenever it is resized. That was tried and looked
// worse than what it fixed. Read the API from a desktop, or read
// /api/openapi.yaml, which is legible anywhere.

// The pinned renderer. Both hashes are the ones Huma carries for this version,
// and a browser refuses the file if what the CDN serves stops matching them.
const (
	elementsStyles          = "https://unpkg.com/@stoplight/elements@9.0.15/styles.min.css"
	elementsStylesIntegrity = "sha384-iVQBHadsD+eV0M5+ubRCEVXrXEBj+BqcuwjUwPoVJc0Pb1fmrhYSAhL+BFProHdV"

	elementsScript          = "https://unpkg.com/@stoplight/elements@9.0.15/web-components.min.js"
	elementsScriptIntegrity = "sha384-xjOcq9PZ/k+pGtPS/xcsCRXGjKKfTlIa4H1IYEnC+97jNa6sAMWTNrV6hY08W3GL"
)

// docsStyles is the whole stylesheet of the page.
//
// Elements draws into the light DOM, so one rule reaches the footer it puts in
// its sidebar. The page belongs to this deployment rather than to the tool
// that renders it; Elements is Apache-2.0 and asks for its notice in the
// source, where the dependency is declared, rather than on screen.
const docsStyles = `
      a[href*="stoplight.io"] { display: none !important; }
`

// docsPage renders the documentation page and the policy it is served under.
func docsPage() (page []byte, policy string) {
	page = []byte(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="referrer" content="no-referrer">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>` + Title + `</title>
    <link rel="stylesheet" href="` + elementsStyles + `" crossorigin integrity="` + elementsStylesIntegrity + `">
    <script src="` + elementsScript + `" crossorigin integrity="` + elementsScriptIntegrity + `"></script>
    <style>` + docsStyles + `</style>
  </head>
  <body style="height: 100vh;">
    <elements-api
      apiDescriptionUrl="` + OpenAPIPath + `.yaml"
      router="hash"
      layout="sidebar"
      tryItCredentialsPolicy="same-origin"
    ></elements-api>
  </body>
</html>`)

	policy = strings.Join([]string{
		"default-src 'none'",
		"base-uri 'none'",
		// The console issues its requests against this deployment, and the
		// document it reads is served by it too.
		"connect-src 'self'",
		"form-action 'none'",
		"frame-ancestors 'none'",
		"sandbox allow-same-origin allow-scripts allow-popups allow-popups-to-escape-sandbox allow-downloads",
		"script-src " + elementsScript,
		// Elements styles itself from JavaScript, so inline styles are what it
		// needs rather than a convenience for the rule above.
		"style-src 'unsafe-inline' " + elementsStyles,
	}, "; ")

	return page, policy
}

// docsHandler serves the documentation page. It is rendered once, at startup,
// since nothing in it depends on the request.
func docsHandler() http.HandlerFunc {
	page, policy := docsPage()

	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Security-Policy", policy)
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(page)
	}
}
