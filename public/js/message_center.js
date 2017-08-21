/*{ This is the data structure of the chat app
    "threads": {
        "thread1": {
            "title": "This is the title of the thread",
            "outlet_id": 1,
            "creator": "outlet/HQ/sales"
            "comments": {
                "comment1": true
            },
            "groups": [
                "HQ",
                "sales"
            ],
            "last_updated": "7/16/2015, 3:28:58 PM",
            "last_read" : "7/16/2015, 2:34:25 PM"
        }
    },
    "comments": {
        "comment1": {
            "thread_id": "thread1",
            "body": "This is a great comment",
            "timestamp": "7/16/2015, 3:28:58 PM",
            "source": "outlet/HQ/sales"
        }
    }
}*/

var commentsRef = new Firebase(CHAT_URL + "/comments");
var threadsRef = new Firebase(CHAT_URL + "/threads");
var unread_counter = 0;

// Showing the list of threads
threadsRef.on("child_added", function(snap) {
  var thread_id = snap.key();
  var thread_content = snap.val();
  var last_updated = new Date(thread_content.last_updated);
  var last_read = new Date(thread_content.last_read);
  var read_status = (last_read >= last_updated)?"<img src='img/icons/Delivered.png' />":"&nbsp;";
  if (thread_content.outlet_id == OUTLET_ID) {
    $("#message-threads-dialog .modal-body").append("<div id='"+ thread_id + "'" + "class='message_thread'><span class='unread_image'>"+read_status+"</span><span class='thread_text'>"+thread_content.creator+" <a class=\"threads \" onClick='displayComments(\""+thread_id+"\", \""+thread_content.title+"\");' href='javascript:void(0)'>"
        + thread_content.title+"</a><span class='last_updated'>"+thread_content.last_updated+"</span></span></div>");

    // special case hack. This is due to firebase events firing in a bad way
    if (last_read.toString() == (new Date('2015-1-1')).toString()) {
      unread_counter--;
    }
    if(last_read < last_updated) {
      unread_counter++;
    }
  }
  $("#message_center .num_threads .num").text(unread_counter);
});

threadsRef.on("child_changed", function(snap) {
  var thread_id = snap.key();
  var thread_content = snap.val();
  var last_updated = new Date(thread_content.last_updated);
  var last_read = new Date(thread_content.last_read);
  var read_status = (last_read >= last_updated)?"<img src='img/icons/Delivered.png' />":"&nbsp;";
  if (thread_content.outlet_id == OUTLET_ID) {
    $("#" + thread_id).find("span:eq(0)").html(read_status);

    if(last_read < last_updated) {
      unread_counter++;
    } else {
      unread_counter--;
    }
  }
  $("#message_center .num_threads .num").text(unread_counter);
});

function displayComments(thread_id, thread_title) {
    $("#message-threads-dialog").modal("hide");
    $("#message-comments-dialog").attr("data-thread_id", thread_id);
    $("#message-comments-dialog .modal-body .comments").empty();
    var threadCommentsRef = threadsRef.child(thread_id).child("comments");
    $("#message-comments-dialog .modal-body .thread_title").text('Subject: ' + thread_title);
    $("#message-comments-dialog .modal-body .reply_text").val("");
    threadCommentsRef.once("value", function(snap) {
      snap.forEach(function(childSnapshot) {
        commentsRef.child(childSnapshot.key()).once("value", function(comment_val) {
          // Render the comment on the link page.
          var comment = comment_val.val().body;
          var comment_timestamp = comment_val.val().timestamp;
          var source = comment_val.val().source;
          if (source == "outlet") {
            $("#message-comments-dialog .modal-body .comments").append('<div class="comment outlet_comment"><div class="comment_text">'+ comment +'</div><div class="timestamp">'+comment_timestamp+'</div></div>');
          } else {
            $("#message-comments-dialog .modal-body .comments").append('<div class="comment hq_comment"><div class="source">From: '+source+'</div><div class="comment_text">'+ comment +'</div><div class="timestamp">'+comment_timestamp+'</div></div>');
          }

        });
      });
    });
    // Check if last_read is already more than last_updated, if yes, then increment
    // the counter
    threadsRef.child("/" + thread_id).once("value", function(data) {
      data = data.val();
      var last_updated = new Date(data.last_updated);
      var last_read = new Date(data.last_read);
      if (last_read >= last_updated) {
        $("#message_center .num_threads .num").text(++unread_counter);
      }
      threadsRef.child("/" + thread_id + "/last_read").set((new Date()).toLocaleString());
    });
    $("#message-comments-dialog").modal("show");
}

$("#message-comments-dialog .modal-body .reply_button").click(function() {
    var comment_text = $("#message-comments-dialog .modal-body .reply_text").val();
    var thread_id = $("#message-comments-dialog").attr("data-thread_id");
    var id = commentsRef.push();
    var comment = {"thread_id": thread_id,
        "body": comment_text,
        "timestamp": (new Date()).toLocaleString(),
        "source": "outlet"
      };
    id.set(comment, function(err) {
      if (!err) {
        //increment the counter if last read is already more than last updated
        var name = id.key();
        threadsRef.child("/" + thread_id).once("value", function(data) {
          data = data.val();
          var last_updated = new Date(data.last_updated);
          var last_read = new Date(data.last_read);
          if (last_read >= last_updated) {
            $("#message_center .num_threads .num").text(++unread_counter);
          }
          var commentsNode = "comments/" + name;
          var updateDict = {
            "last_updated": comment.timestamp,
            "last_read": comment.timestamp
          };
          updateDict[commentsNode] = true;
          threadsRef.child("/" + thread_id).update(updateDict);
        });
      } else {
        console.error(err);
      }
      $("#message-comments-dialog").modal("hide");
    });
});

$(".compose_message").click(function() {
  // Hiding all the other modals
  $("#message-threads-dialog").modal("hide");
  $("#message-comments-dialog").modal("hide");
  // populate the drop down
  var dropdown_string = '<select class="form-control">';
  // Creating the item select drop down from the stock count
  /*for (var i = 0; i < roles.length; i++) {
    dropdown_string += '<option>'+ roles[i] +'</option>';
  }*/
  dropdown_string += '</select>';
  $("#compose-message-dialog .modal-body .send_to").empty();
  $("#compose-message-dialog .modal-body .send_to").append(dropdown_string);
  // Clearing out old values
  $("#compose-message-dialog .modal-body .subject").val("");
  $("#compose-message-dialog .modal-body textarea").val("");
  // show the dialog
  $("#compose-message-dialog").modal("show");
});

$("#compose-message-dialog .modal-footer .reply_button").click(function() {
    var id = threadsRef.push();
    var outlet_id = OUTLET_ID;
    // Hiding any other open dialogs
    $("#message-comments-dialog").modal("hide");
    $("#message-threads-dialog").modal("hide");
    // take the input
    // send the data
    var group_name = $("#compose-message-dialog .modal-body select").val();
    var thread_title = $("#compose-message-dialog .modal-body .subject").val();
    var ts = (new Date()).toLocaleString();
    var last_read = (new Date('2015-1-1')).toLocaleString();
    var thread_content = {
        "title": thread_title,
        "outlet_id": outlet_id,
        "comments": {},
        "groups": [group_name],
        "creator": "outlet",
        "last_updated": ts,
        "last_read": last_read
      };
    id.set(thread_content, function(err) {
      if (err) {
        console.error(err);
      }
      var comment_text = $("#compose-message-dialog .modal-body textarea").val();
      var thread_id = id.key();
      var comment_id = commentsRef.push();
      var comment = {"thread_id": thread_id,
          "body": comment_text,
          "timestamp": ts,
          "source": "outlet"
        };
      comment_id.set(comment, function(err) {
        if (!err) {
          var name = comment_id.key();
          threadsRef.child("/" + thread_id + "/comments/" + name).set(true);
        } else {
          console.error(err);
        }
        // close the dialog
        $("#compose-message-dialog").modal("hide");
      });
    });
});


