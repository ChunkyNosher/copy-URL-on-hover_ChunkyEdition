/**
 * Learning URL Handlers
 * URL detection for learning platforms
 */

import { findGenericUrl } from './generic.js';
import { debug as _debug } from '../../utils/debug.js';

function findCourseraUrl(element) {
  const course = element.closest('[data-e2e="CourseCard"], .CourseCard');
  if (!course) return findGenericUrl(element);

  const link = course.querySelector('a[href*="/learn/"]');
  if (link?.href) return link.href;

  return null;
}

function findUdemyUrl(element) {
  const course = element.closest('[data-purpose="course-card"]');
  if (!course) return findGenericUrl(element);

  const link = course.querySelector('a[href*="/course/"]');
  if (link?.href) return link.href;

  return null;
}

function findEdXUrl(element) {
  const course = element.closest('.course-card, [data-course-id]');
  if (!course) return findGenericUrl(element);

  const link = course.querySelector('a[href*="/course/"]');
  if (link?.href) return link.href;

  return null;
}

function findKhanAcademyUrl(element) {
  const item = element.closest('[data-test-id], .link-item');
  if (!item) return findGenericUrl(element);

  const link = item.querySelector('a[href*="/math/"], a[href*="/science/"]');
  if (link?.href) return link.href;

  return null;
}

function findSkillshareUrl(element) {
  const classCard = element.closest('[data-class-id], .class-card');
  if (!classCard) return findGenericUrl(element);

  const link = classCard.querySelector('a[href*="/classes/"]');
  if (link?.href) return link.href;

  return null;
}

function findPluralsightUrl(element) {
  const course = element.closest('[data-course-id], .course-card');
  if (!course) return findGenericUrl(element);

  const link = course.querySelector('a[href*="/courses/"]');
  if (link?.href) return link.href;

  return null;
}

function findUdacityUrl(element) {
  const course = element.closest('[data-testid="catalog-card"]');
  if (!course) return findGenericUrl(element);

  const link = course.querySelector('a[href*="/course/"]');
  if (link?.href) return link.href;

  return null;
}

export const learningHandlers = {
  coursera: findCourseraUrl,
  udemy: findUdemyUrl,
  edX: findEdXUrl,
  khanAcademy: findKhanAcademyUrl,
  skillshare: findSkillshareUrl,
  pluralsight: findPluralsightUrl,
  udacity: findUdacityUrl
};
