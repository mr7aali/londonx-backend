const fs = require('fs');
let file = fs.readFileSync('src/controllers/bookingController.js', 'utf8');

file = file.replace(
  `function buildBookingFlowDocumentsScreen(booking) {
  const requirements = [];
  const uploadedCount = 0;

  return {
    steps: buildBookingFlowSteps("documents"),
    title: "Upload Full Certificate",
    subtitle: "For those who don't already hold AM2",`,
  `function buildBookingFlowDocumentsScreen(booking) {
  const variant = getChecklistVariantForBooking(booking);
  const requirements = buildDocumentRequirements(booking);
  const uploadedCount = requirements.filter((req) => req.uploaded).length;

  const title = variant === "am2" ? "Upload Full Certificate" : "Upload Required Documents";
  const subtitle = variant === "am2" ? "For those who don't already hold AM2" : "Please provide your evidence";

  return {
    steps: buildBookingFlowSteps("documents"),
    title,
    subtitle,`
);

fs.writeFileSync('src/controllers/bookingController.js', file);
console.log("Successfully replaced file");
