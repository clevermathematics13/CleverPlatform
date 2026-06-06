  async function loadTemplates() {
    try {
      // Fetch templates from ALL grades (not filtered by current gradeLevel)
      const res = await fetch(`/api/assignments/templates/list?grade=all`);
      const data = (await res.json()) as { templates: SavedTemplate[] };
      setTemplates(data.templates ?? []);
    } catch (err) {
      setError(`Failed to load templates: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }