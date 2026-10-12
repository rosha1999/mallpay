const placeholderPrefix = "replace-with-";

export function isConfiguredSecret(
  value: string | null | undefined,
  minimumLength = 32,
): value is string {
  return Boolean(
    value &&
    value.length >= minimumLength &&
    !value.toLowerCase().startsWith(placeholderPrefix),
  );
}
