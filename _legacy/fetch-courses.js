const fs = require('fs');

// UWFlow GraphQL endpoint
const GRAPHQL_ENDPOINT = 'https://uwflow.com/graphql';

// GraphQL query to fetch courses with ratings
const COURSES_QUERY = `
query GetCourses {
  course(order_by: {code: asc}) {
    id
    code
    name
    description
    prereqs
    coreqs
    antireqs
    rating {
      easy
      useful
      liked
      filled_count
    }
    sections(where: {term_id: {_eq: 1261}}) {
      id
      enrollment_total
      enrollment_capacity
    }
  }
}
`;

// User preferences for filtering
const PREFERENCES = {
  excludeLanguageCourses: true,
  excludeCoursesWithPrereqs: true,
  preferNoEnglish: true,
  allowMath: true
};

// Language course codes to exclude
const LANGUAGE_CODES = [
  'ARAB', 'CHINA', 'CROAT', 'FR', 'GER', 'GREEK', 'HINDI', 'ITAL',
  'JAPAN', 'KOREA', 'LAT', 'POLSH', 'PORT', 'RUSS', 'SPAN', 'UKRAN'
];

// Art course codes to exclude
const ART_CODES = [
  'ARTS', 'FINE', 'VCULT', 'THPERF', 'DRAMA', 'STUDIO'
];

// Social/cultural/political course codes to exclude
const SOCIAL_CODES = [
  'GSJ', 'SOC', 'SOCWK', 'PSCI', 'PACS', 'ANTH', 'INDG', 'SDS',
  'CI', 'BLKST', 'HRTS', 'GSJ', 'REES', 'EASIA', 'SI', 'RCS',
  'ERS', 'HIST', 'CLAS', 'MEDVL', 'ITALST', 'SRF', 'JS'
];

// Other excluded course codes
const OTHER_EXCLUDED = [
  'MUSIC', 'GEOG', 'KIN', 'CHEM', 'CHE', 'BIOL'
];

// Essay-heavy course codes to exclude
const ESSAY_HEAVY = [
  'PHIL', 'COMMST', 'BASE', 'EMLS', 'LS', 'ENVS', 'REC', 'HHUM',
  'PSYCH', 'GENE'
];

// SYDE-related courses to exclude (overlap with Systems Design Engineering)
const SYDE_OVERLAP = [
  'PHYS', 'CS', 'ME', 'MSE', 'INTEG', 'MNS', 'SYDE', 'ECE', 'MATH', 'MTHEL'
];

// Health and environment courses to exclude
const HEALTH_ENV = [
  'HEALTH', 'EARTH', 'ENBUS', 'GESC', 'UNIV'
];

// Courses already completed (can be used as prereqs)
const COMPLETED_COURSES = ['math116', 'math117'];

async function fetchCourses() {
  console.log('Fetching courses from UWFlow...');

  try {
    const response = await fetch(GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: COURSES_QUERY
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    if (data.errors) {
      console.error('GraphQL errors:', data.errors);
      return null;
    }

    return data.data.course;
  } catch (error) {
    console.error('Error fetching courses:', error);
    return null;
  }
}

function filterCourses(courses) {
  console.log(`Total courses fetched: ${courses.length}`);

  return courses.filter(course => {
    const codePrefix = course.code.split(/\d/)[0].toUpperCase();

    // Filter out language courses
    if (PREFERENCES.excludeLanguageCourses && LANGUAGE_CODES.includes(codePrefix)) {
      return false;
    }

    // Filter out art courses
    if (ART_CODES.includes(codePrefix)) {
      return false;
    }

    // Filter out social/cultural/political courses
    if (SOCIAL_CODES.includes(codePrefix)) {
      return false;
    }

    // Filter out other excluded courses (music, geography, kin, chem, bio)
    if (OTHER_EXCLUDED.includes(codePrefix)) {
      return false;
    }

    // Filter out essay-heavy courses (but allow PSYCH101)
    if (ESSAY_HEAVY.includes(codePrefix)) {
      if (course.code.toLowerCase() !== 'psych101') {
        return false;
      }
    }

    // Filter out ancient history related courses
    const nameLower = course.name.toLowerCase();
    if (nameLower.includes('ancient') || nameLower.includes('medieval')) {
      return false;
    }

    // Filter out Wilfrid Laurier University courses
    if (course.code.toLowerCase().endsWith('w') || nameLower.includes('wlu')) {
      return false;
    }

    // Filter out SYDE-related courses (overlap with Systems Design Engineering)
    if (SYDE_OVERLAP.includes(codePrefix)) {
      return false;
    }

    // Filter out health and environment courses
    if (HEALTH_ENV.includes(codePrefix)) {
      return false;
    }
    if (nameLower.includes('environment') || nameLower.includes('climate') || nameLower.includes('sustainability')) {
      return false;
    }

    // Filter out courses with easiness < 40% AND usefulness < 50%
    const easy = course.rating?.easy;
    const useful = course.rating?.useful;
    if (easy !== null && easy !== undefined && useful !== null && useful !== undefined) {
      if (easy < 0.40 && useful < 0.50) {
        return false;
      }
    }

    // Filter out courses with prerequisites (unless we've completed them)
    if (course.prereqs && course.prereqs.trim() !== '') {
      const prereqLower = course.prereqs.toLowerCase();
      // Check if prereqs only contain courses we've completed
      const hasUnmetPrereqs = !COMPLETED_COURSES.some(completed => prereqLower.includes(completed)) ||
        prereqLower.match(/[a-z]{2,}[0-9]{2,}/gi)?.some(prereq =>
          !COMPLETED_COURSES.includes(prereq.toLowerCase())
        );
      if (hasUnmetPrereqs) {
        return false;
      }
    }

    // Filter out English courses (but keep if user allows)
    if (PREFERENCES.preferNoEnglish && codePrefix === 'ENGL') {
      return false;
    }

    // Only include courses that have sections available (spring 2026 term)
    if (!course.sections || course.sections.length === 0) {
      return false;
    }

    // Check if there's room available
    const hasRoom = course.sections.some(s =>
      s.enrollment_capacity > s.enrollment_total
    );
    if (!hasRoom) {
      return false;
    }

    // Only include 100-300 level courses (based on URL params)
    const levelMatch = course.code.match(/\d+/);
    if (levelMatch) {
      const level = parseInt(levelMatch[0]);
      if (level >= 400) {
        return false;
      }
    }

    return true;
  });
}

function formatScore(score) {
  if (score === null || score === undefined) return 'N/A';
  return (score * 100).toFixed(0) + '%';
}

function generateMarkdown(courses) {
  // Sort by usefulness score (descending)
  const sortedCourses = courses.sort((a, b) => {
    const useA = a.rating?.useful ?? 0;
    const useB = b.rating?.useful ?? 0;
    return useB - useA;
  });

  let md = `# Spring 2026 Elective Course Options

## Preferences Applied
- No language courses
- No art courses
- No social/cultural/political courses
- No music, geography, kinesiology, chemistry, biology
- No essay-heavy courses (philosophy, communications, writing)
- No psychology (except PSYCH101), no GENE courses
- No ancient/medieval history
- No SYDE overlap (physics, CS, engineering, math, design)
- No health/environment courses
- No Wilfrid Laurier (WLU) courses
- No courses with easiness <40% AND usefulness <50%
- Prerequisites: only MATH116/117 (completed)
- No English courses
- 100-300 level courses only
- Must have room available

## Courses (${sortedCourses.length} found)

| Course Code | Name | Usefulness | Easiness | Description |
|-------------|------|------------|----------|-------------|
`;

  for (const course of sortedCourses) {
    const usefulness = formatScore(course.rating?.useful);
    const easiness = formatScore(course.rating?.easy);

    // Truncate description for table format
    let desc = course.description || 'No description available';
    desc = desc.replace(/\n/g, ' ').replace(/\|/g, '-');
    if (desc.length > 100) {
      desc = desc.substring(0, 100) + '...';
    }

    md += `| ${course.code} | ${course.name} | ${usefulness} | ${easiness} | ${desc} |\n`;
  }

  // Add detailed sections for top courses
  md += `\n## Top Recommended Courses (High Usefulness)\n\n`;

  const topCourses = sortedCourses.slice(0, 20);
  for (const course of topCourses) {
    md += `### ${course.code} - ${course.name}\n\n`;
    md += `- **Usefulness:** ${formatScore(course.rating?.useful)}\n`;
    md += `- **Easiness:** ${formatScore(course.rating?.easy)}\n`;
    md += `- **Liked:** ${formatScore(course.rating?.liked)}\n`;
    md += `- **Reviews:** ${course.rating?.filled_count || 0}\n\n`;
    md += `**Description:** ${course.description || 'No description available'}\n\n`;
    md += `---\n\n`;
  }

  return md;
}

async function main() {
  const courses = await fetchCourses();

  if (!courses) {
    console.error('Failed to fetch courses. Please check the API.');
    process.exit(1);
  }

  const filtered = filterCourses(courses);
  console.log(`Courses after filtering: ${filtered.length}`);

  const markdown = generateMarkdown(filtered);

  fs.writeFileSync('course-list.md', markdown);
  console.log('Course list saved to course-list.md');
}

main();
