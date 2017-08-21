// This will list the food_item issues
$("#issues .panel_header .food_btn").click(function() {
  populateFoodIssues(getSelectedDate());
});

$("#issues .panel_header .non_food_btn").click(function() {
  populateNonFoodIssues(getSelectedDate());
});

function populateFoodIssues(time) {
  $("#issues .non_food_issues").hide();
  $("#issues .food_issues").show();
  $.getJSON(OUTLET_URL + '/outlet_app/food_item_issues?time='+time)
  .done(function(data) {
    var food_item_issues = data;
    var targetDiv = $("#issues .food_issues tbody");
    $(targetDiv).empty();
    for (var i = 0; i < food_item_issues.length; i++) {
      var date_obj = new Date(food_item_issues[i]["green_signal_time"]);
      $(targetDiv).append('<tr><td>'+food_item_issues[i]["name"]+'</td><td>'+food_item_issues[i]["problem"]+'</td><td>'+food_item_issues[i]["note"]+'</td><td>'+ date_obj.toLocaleTimeString()+'</td></tr>');
    }
    $("#issues .food_btn").css("background-color", "#CCCCCC");
    $("#issues .non_food_btn").css("background-color", "white");
    $("#issues .non_food_btn").css("border", "1px solid #CCCCCC");
  })
  .fail(function(jqxhr, textStatus, error) {
    var err_msg = textStatus + ", " + jqxhr.responseText;
    console.error("Request Failed: " + err_msg);
  });
}

function populateNonFoodIssues(time) {
  $("#issues .food_issues").hide();
  $("#issues .non_food_issues").show();
  $.getJSON(OUTLET_URL + '/outlet_app/non_food_item_issues?time='+time)
  .done(function(data) {
    var non_food_issues = data;
    var targetDiv = $("#issues .non_food_issues tbody");
    $(targetDiv).empty();
    for (var i = 0; i < non_food_issues.length; i++) {
      var date_obj = new Date(non_food_issues[i]["time"]);
      var parent_category = non_food_issues[i]["type"].split(':')[0];
      var sub_category = non_food_issues[i]["type"].split(':')[1];
      $(targetDiv).append('<tr><td>'+parent_category+'</td><td>'+sub_category+'</td><td>'+non_food_issues[i]["note"]+'</td><td>'+ date_obj.toLocaleTimeString()+'</td></tr>');
    }
    $("#issues .non_food_btn").css("background-color", "#CCCCCC");
    $("#issues .food_btn").css("background-color", "white");
    $("#issues .food_btn").css("border", "1px solid #CCCCCC");
  })
  .fail(function(jqxhr, textStatus, error) {
    var err_msg = textStatus + ", " + jqxhr.responseText;
    console.error("Request Failed: " + err_msg);
  });
}

$("#issues #date_selector").change(function () {
  //populate the appropriate tab based on which is selected.
  var display_flag = $("#issues .food_issues").css("display");
  if (display_flag != 'none') {
    populateFoodIssues(getSelectedDate());
  } else {
    populateNonFoodIssues(getSelectedDate());
  }
});

$("#issues .prev_day").click(function(){
  var input_value = getSelectedDate();
  if (input_value != 'now') {
    var selected = new Date(input_value);
    var prev_day = new Date(selected);
    prev_day.setDate(selected.getDate() - 1);
    $("#issues #date_selector").val(prev_day.yyyymmdd());
  }
  $("#issues #date_selector").trigger("change");
});

$("#issues .next_day").click(function(){
  var input_value = getSelectedDate();
  if (input_value != 'now') {
    var selected = new Date(input_value);
    var next_day = new Date(selected);
    next_day.setDate(selected.getDate() + 1);
    $("#issues #date_selector").val(next_day.yyyymmdd());
  }
  $("#issues #date_selector").trigger("change");
});

function getSelectedDate() {
  var date = $("#issues #date_selector").val();
  if (date == "") {
    date = 'now';
  }
  return date;
}

