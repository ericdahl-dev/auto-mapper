// "(sound is off)" beside a setting that follows sound while sound is off (#125): otherwise the slider
// seems to do nothing. One click opens the Sound section and puts you on its on/off switch.

export function soundOffNote(): HTMLButtonElement {
  const note = Object.assign(document.createElement("button"), {
    type: "button", className: "sound-off", textContent: "(sound is off)", title: "Turn sound on in the Sound section",
  });
  note.addEventListener("click", (ev) => {
    ev.preventDefault(); // inside the setting's label: don't pass the click on to its slider
    const fold = document.querySelector<HTMLDetailsElement>("details.fold[data-fold=sound]");
    if (fold) fold.open = true;
    const toggle = document.getElementById("sound-toggle");
    toggle?.focus();
    toggle?.scrollIntoView({ block: "nearest" });
  });
  return note;
}
