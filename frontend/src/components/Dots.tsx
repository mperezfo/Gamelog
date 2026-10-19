/** An ellipsis whose dots bob in turn, to show the search is under way. */
export function Dots() {
  return (
    // A little apart from the word and from each other: set as tight as a
    // typed ellipsis, the moving dots read as crowding the text.
    <span aria-hidden="true" className="ml-0.5 inline-flex gap-px">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="inline-block animate-[gl-bob_1.2s_ease-in-out_infinite] motion-reduce:animate-none"
          style={{ animationDelay: `${delay}ms` }}
        >
          .
        </span>
      ))}
    </span>
  )
}
