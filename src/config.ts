export const SITE = {
  website: "https://tannerjallen.com/", // replace this with your deployed domain
  author: "Tanner J. allen",
  profile: "https://tannerjallen.com/",
  desc: "A blog about software engineering, web development, and other tech topics.",
  title: "Tanner J. Allen",
  ogImage: "astropaper-og.jpg",
  lightAndDarkMode: true,
  postPerIndex: 4,
  postPerPage: 4,
  scheduledPostMargin: 15 * 60 * 1000, // 15 minutes
  showArchives: false,
  showBackButton: true, // show back button in post detail
  editPost: {
    disabled: true
  },
  dynamicOgImage: true,
} as const;
