export function validateCommandSchema(commands) {
  const errors = [];

  function visit(options, path) {
    let optionalSeen = false;
    for (const option of options ?? []) {
      if (option.required === true && optionalSeen) {
        errors.push(`${path}: required option ${option.name} follows an optional option`);
      } else if (option.required !== true) {
        optionalSeen = true;
      }
      if (Array.isArray(option.options)) {
        visit(option.options, `${path} ${option.name}`);
      }
    }
  }

  for (const command of commands) visit(command.options, `/${command.name}`);
  if (errors.length > 0) {
    throw new Error(`Invalid Discord command schema:\n${errors.join("\n")}`);
  }
}
