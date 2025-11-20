/**
 * Learning Platform URL Handlers Tests
 * Tests for learning platform URL detection (Coursera, Udemy, etc.)
 */

import { learningHandlers } from '../../../src/features/url-handlers/learning.js';

const {
  coursera: findCourseraUrl,
  udemy: findUdemyUrl,
  edX: findEdXUrl,
  khanAcademy: findKhanAcademyUrl,
  skillshare: findSkillshareUrl,
  pluralsight: findPluralsightUrl,
  udacity: findUdacityUrl
} = learningHandlers;

describe('Learning Platform URL Handlers', () => {
  describe('findCourseraUrl', () => {
    test('should extract URL from data-e2e CourseCard', () => {
      const card = document.createElement('div');
      card.setAttribute('data-e2e', 'CourseCard');

      const link = document.createElement('a');
      link.href = 'https://www.coursera.org/learn/machine-learning';
      card.appendChild(link);

      const element = document.createElement('span');
      card.appendChild(element);

      const result = findCourseraUrl(element);

      expect(result).toBe('https://www.coursera.org/learn/machine-learning');
    });

    test('should extract URL from CourseCard class', () => {
      const card = document.createElement('div');
      card.className = 'CourseCard';

      const link = document.createElement('a');
      link.href = 'https://www.coursera.org/learn/python-programming';
      card.appendChild(link);

      const element = document.createElement('div');
      card.appendChild(element);

      const result = findCourseraUrl(element);

      expect(result).toBe('https://www.coursera.org/learn/python-programming');
    });

    test('should fallback to generic when no course found', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);

      const result = findCourseraUrl(link);

      expect(result).toBe('https://example.com/');
    });

    test('should return null when no link in course card', () => {
      const card = document.createElement('div');
      card.setAttribute('data-e2e', 'CourseCard');

      const element = document.createElement('div');
      card.appendChild(element);

      const result = findCourseraUrl(element);

      expect(result).toBeNull();
    });
  });

  describe('findUdemyUrl', () => {
    test('should extract URL from course-card', () => {
      const card = document.createElement('div');
      card.setAttribute('data-purpose', 'course-card');

      const link = document.createElement('a');
      link.href = 'https://www.udemy.com/course/the-complete-web-development-bootcamp/';
      card.appendChild(link);

      const element = document.createElement('span');
      card.appendChild(element);

      const result = findUdemyUrl(element);

      expect(result).toBe('https://www.udemy.com/course/the-complete-web-development-bootcamp/');
    });

    test('should extract course URL with query params', () => {
      const card = document.createElement('div');
      card.setAttribute('data-purpose', 'course-card');

      const link = document.createElement('a');
      link.href = 'https://www.udemy.com/course/python-for-data-science/?couponCode=ABC123';
      card.appendChild(link);

      const element = document.createElement('div');
      card.appendChild(element);

      const result = findUdemyUrl(element);

      expect(result).toBe('https://www.udemy.com/course/python-for-data-science/?couponCode=ABC123');
    });

    test('should fallback to generic when no course found', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);

      const result = findUdemyUrl(link);

      expect(result).toBe('https://example.com/');
    });

    test('should return null when no link in course card', () => {
      const card = document.createElement('div');
      card.setAttribute('data-purpose', 'course-card');

      const element = document.createElement('div');
      card.appendChild(element);

      const result = findUdemyUrl(element);

      expect(result).toBeNull();
    });
  });

  describe('findEdXUrl', () => {
    test('should extract URL from course-card', () => {
      const card = document.createElement('div');
      card.className = 'course-card';

      const link = document.createElement('a');
      link.href = 'https://www.edx.org/course/introduction-to-computer-science';
      card.appendChild(link);

      const element = document.createElement('span');
      card.appendChild(element);

      const result = findEdXUrl(element);

      expect(result).toBe('https://www.edx.org/course/introduction-to-computer-science');
    });

    test('should extract URL from data-course-id element', () => {
      const course = document.createElement('div');
      course.setAttribute('data-course-id', '123456');

      const link = document.createElement('a');
      link.href = 'https://www.edx.org/course/artificial-intelligence';
      course.appendChild(link);

      const element = document.createElement('div');
      course.appendChild(element);

      const result = findEdXUrl(element);

      expect(result).toBe('https://www.edx.org/course/artificial-intelligence');
    });

    test('should fallback to generic when no course found', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);

      const result = findEdXUrl(link);

      expect(result).toBe('https://example.com/');
    });
  });

  describe('findKhanAcademyUrl', () => {
    test('should extract math URL from data-test-id element', () => {
      const item = document.createElement('div');
      item.setAttribute('data-test-id', 'lesson-card');

      const link = document.createElement('a');
      link.href = 'https://www.khanacademy.org/math/algebra';
      item.appendChild(link);

      const element = document.createElement('span');
      item.appendChild(element);

      const result = findKhanAcademyUrl(element);

      expect(result).toBe('https://www.khanacademy.org/math/algebra');
    });

    test('should extract science URL from link-item', () => {
      const item = document.createElement('div');
      item.className = 'link-item';

      const link = document.createElement('a');
      link.href = 'https://www.khanacademy.org/science/physics';
      item.appendChild(link);

      const element = document.createElement('div');
      item.appendChild(element);

      const result = findKhanAcademyUrl(element);

      expect(result).toBe('https://www.khanacademy.org/science/physics');
    });

    test('should fallback to generic when no item found', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);

      const result = findKhanAcademyUrl(link);

      expect(result).toBe('https://example.com/');
    });

    test('should return null when no math/science link in item', () => {
      const item = document.createElement('div');
      item.setAttribute('data-test-id', 'lesson-card');

      const link = document.createElement('a');
      link.href = 'https://www.khanacademy.org/other';
      item.appendChild(link);

      const element = document.createElement('div');
      item.appendChild(element);

      const result = findKhanAcademyUrl(element);

      expect(result).toBeNull();
    });
  });

  describe('findSkillshareUrl', () => {
    test('should extract URL from data-class-id element', () => {
      const card = document.createElement('div');
      card.setAttribute('data-class-id', '789012');

      const link = document.createElement('a');
      link.href = 'https://www.skillshare.com/classes/Graphic-Design-Basics/789012';
      card.appendChild(link);

      const element = document.createElement('span');
      card.appendChild(element);

      const result = findSkillshareUrl(element);

      expect(result).toBe('https://www.skillshare.com/classes/Graphic-Design-Basics/789012');
    });

    test('should extract URL from class-card', () => {
      const card = document.createElement('div');
      card.className = 'class-card';

      const link = document.createElement('a');
      link.href = 'https://www.skillshare.com/classes/Photography-101/123456';
      card.appendChild(link);

      const element = document.createElement('div');
      card.appendChild(element);

      const result = findSkillshareUrl(element);

      expect(result).toBe('https://www.skillshare.com/classes/Photography-101/123456');
    });

    test('should fallback to generic when no class card found', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);

      const result = findSkillshareUrl(link);

      expect(result).toBe('https://example.com/');
    });
  });

  describe('findPluralsightUrl', () => {
    test('should extract URL from data-course-id element', () => {
      const course = document.createElement('div');
      course.setAttribute('data-course-id', 'react-getting-started');

      const link = document.createElement('a');
      link.href = 'https://www.pluralsight.com/courses/react-getting-started';
      course.appendChild(link);

      const element = document.createElement('span');
      course.appendChild(element);

      const result = findPluralsightUrl(element);

      expect(result).toBe('https://www.pluralsight.com/courses/react-getting-started');
    });

    test('should extract URL from course-card', () => {
      const card = document.createElement('div');
      card.className = 'course-card';

      const link = document.createElement('a');
      link.href = 'https://www.pluralsight.com/courses/python-fundamentals';
      card.appendChild(link);

      const element = document.createElement('div');
      card.appendChild(element);

      const result = findPluralsightUrl(element);

      expect(result).toBe('https://www.pluralsight.com/courses/python-fundamentals');
    });

    test('should fallback to generic when no course found', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);

      const result = findPluralsightUrl(link);

      expect(result).toBe('https://example.com/');
    });
  });

  describe('findUdacityUrl', () => {
    test('should extract URL from catalog-card', () => {
      const card = document.createElement('div');
      card.setAttribute('data-testid', 'catalog-card');

      const link = document.createElement('a');
      link.href = 'https://www.udacity.com/course/full-stack-web-developer-nanodegree--nd0044';
      card.appendChild(link);

      const element = document.createElement('span');
      card.appendChild(element);

      const result = findUdacityUrl(element);

      expect(result).toBe('https://www.udacity.com/course/full-stack-web-developer-nanodegree--nd0044');
    });

    test('should extract nanodegree URL', () => {
      const card = document.createElement('div');
      card.setAttribute('data-testid', 'catalog-card');

      const link = document.createElement('a');
      link.href = 'https://www.udacity.com/course/data-scientist-nanodegree--nd025';
      card.appendChild(link);

      const element = document.createElement('div');
      card.appendChild(element);

      const result = findUdacityUrl(element);

      expect(result).toBe('https://www.udacity.com/course/data-scientist-nanodegree--nd025');
    });

    test('should fallback to generic when no course found', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);

      const result = findUdacityUrl(link);

      expect(result).toBe('https://example.com/');
    });

    test('should return null when no link in catalog card', () => {
      const card = document.createElement('div');
      card.setAttribute('data-testid', 'catalog-card');

      const element = document.createElement('div');
      card.appendChild(element);

      const result = findUdacityUrl(element);

      expect(result).toBeNull();
    });
  });
});
